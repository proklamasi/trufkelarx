// At the top of the file, add debounce utility
const debounce = (fn, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
};

const puppeteer = require('puppeteer');
const io = require('socket.io-client');

let sharedBrowser = null;

async function waitForServer(url, timeout = 30000) {
    const start = Date.now();
    console.log('Checking server status...');
    
    while (Date.now() - start < timeout) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                console.log('Server is ready!');
                return true;
            }
        } catch (error) {
            console.log('Waiting for server...');
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    throw new Error(`Server not ready at ${url} after ${timeout}ms`);
}



async function createBot(botName) {
    console.log(`\nInitializing ${botName}...`);
    const socket = io.connect('http://localhost:3000');
    
    await new Promise(resolve => socket.once('connect', resolve));
    console.log(`${botName}: Socket connected`);

    // Update browser launch configuration
    if (!sharedBrowser) {
        sharedBrowser = await puppeteer.launch({ 
            headless: 'new',  // Use new headless mode
            args: ['--no-sandbox']
        });
    }
        
    const page = await sharedBrowser.newPage();
    page.setDefaultNavigationTimeout(60000);
    
    // Add game state tracking
    const bot = { 
        name: botName,
        socket: socket,
        page: page,
        hasBid: false,
        hasPlayedCard: false,
        hasPlayedBidCard: false,  // Add this
        gameStarted: false,
        bidInProgress: false,  // Add this new property
        allBidsPlaced: false,  // New flag to track bidding completion
        currentPhase: 'waiting',    // Track current phase
        isMyTurn: false,       // Track turn state
        lastPhaseChange: 0,    // Track last phase change time
        lastTurnUpdate: 0,      // Track last turn update time
        bidPlacedIds: new Set(),  // Track processed bid IDs
        lastBidTime: 0,           // Track last bid time
        isFullyInitialized: false,  // New flag for complete initialization
        initializationTime: Date.now(),
        minInitDelay: 5000,  // Minimum time to wait after initialization
        maxInitAttempts: 30,    // New: Maximum initialization attempts
        initAttempts: 0,        // New: Track initialization attempts
        hand: [],
        waitingForStart: true,   // New: Track waiting for game start
        currentTurn: null,
        lastCardPlayTime: 0,
        minPlayDelay: 1000,
        lastPlayingPhaseUpdate: 0,
        playingPhaseDelay: 2000,
        leadSuit: null,       // Track the suit that leads the round
        playedThisTrick: false,  // Track if bot played in current trick
        bidCard: null,  // Track the card used for bidding
        isBidWinner: false,  // Track if this bot won the bid
    };


    try {
        await page.goto('http://localhost:3000', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        
        await page.waitForSelector('#username', { timeout: 60000 });
        await page.$eval('#username', (el, name) => el.value = name, botName);
        
        await Promise.all([
            page.$eval('form', form => form.dispatchEvent(new Event('submit'))),
            new Promise(resolve => setTimeout(resolve, 1000))
        ]);
        
        console.log(`${botName}: Joined game successfully`);
        socket.emit('joinGame', botName);

    } catch (error) {
        console.error(`${botName}: Error joining game -`, error);
        await page.close();
        throw error;
    }

    // 2. Update gameStarted handler to mark full initialization
    socket.on('gameStarted', async (gameState) => {
        if (bot.gameStarted) {
            console.log(`${bot.name}: Already in game, ignoring duplicate start`);
            return;
        }
        
        try {
            const player = gameState.players.find(p => p.name === bot.name);
            if (player?.hand) {
                bot.hand = player.hand;
                bot.gameStarted = true;
                bot.isFullyInitialized = true;
                bot.waitingForStart = false;
                console.log(`${bot.name}: Fully initialized with ${bot.hand.length} cards`);
            } else {
                bot.initAttempts++;
                if (bot.initAttempts >= bot.maxInitAttempts) {
                    throw new Error('Max initialization attempts reached');
                }
                console.log(`${bot.name}: Waiting for hand... (attempt ${bot.initAttempts}/${bot.maxInitAttempts})`);
            }
        } catch (error) {
            console.error(`${bot.name}: Error in game start:`, error);
            throw error; // Propagate error for proper handling
        }
    });

    socket.on('playingPhase', async (data) => {
        // Check if we're in a valid state to play
        const isMyTurn = data.currentTurn === socket.id;
        const canPlay = bot.currentPhase === 'playing1-phase' && 
                       bot.hand.length > 0 && 
                       !bot.hasPlayedCard && 
                       !bot.playedThisTrick;
    
        console.log(`${bot.name}: Playing phase check:`, {
            isMyTurn,
            isBidWinner: bot.isBidWinner,
            currentTurn: data.currentTurn,
            myId: socket.id,
            phase: bot.currentPhase,
            handLength: bot.hand.length,
            leadSuit: bot.leadSuit
        });
    
        // Bid winner leads first
        if (bot.isBidWinner && !bot.playedThisTrick && bot.hand.length > 0) {
            try {
                await page.evaluate(() => 
                    new Promise(resolve => setTimeout(resolve, 500))
                );
    
                const cardToPlay = bot.hand[0];  // Bid winner can play any card
                console.log(`${bot.name}: Leading as bid winner with:`, cardToPlay);
    
                const clicked = await page.evaluate((cardData) => {
                    const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                    const targetCard = cards.find(card => 
                        card.getAttribute('data-suit') === cardData.suit
                    );
                    if (targetCard) {
                        targetCard.click();
                        return true;
                    }
                    return false;
                }, cardToPlay);
    
                if (clicked) {
                    socket.emit('playCardPlaying1', {
                        playerId: socket.id,
                        card: cardToPlay,
                        phase: 'playing1-phase'
                    });
                    bot.hasPlayedCard = true;
                    bot.playedThisTrick = true;
                    bot.leadSuit = cardToPlay.suit;  // Set lead suit when leading
                    bot.hand = bot.hand.filter(c => c !== cardToPlay);
                    console.log(`${bot.name}: Led with ${cardToPlay.suit} ${cardToPlay.value}, setting lead suit`);
                }
            } catch (error) {
                console.error(`${bot.name}: Error playing lead card:`, error);
            }
            return;
        }
    
        // Regular turn play - must follow lead suit if possible
        if (isMyTurn && canPlay && bot.leadSuit) {
            try {
                await page.evaluate(() => 
                    new Promise(resolve => setTimeout(resolve, 1000))
                );
    
                // Try to follow suit
                const cardToPlay = bot.hand.find(card => card.suit === bot.leadSuit) || bot.hand[0];
                console.log(`${bot.name}: Following ${bot.leadSuit} with:`, cardToPlay);
    
                const clicked = await page.evaluate((cardData) => {
                    const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                    const targetCard = cards.find(card => 
                        card.getAttribute('data-suit') === cardData.suit
                    );
                    if (targetCard) {
                        targetCard.click();
                        return true;
                    }
                    return false;
                }, cardToPlay);
    
                if (clicked) {
                    socket.emit('playCardPlaying1', {
                        playerId: socket.id,
                        card: cardToPlay,
                        phase: 'playing1-phase'
                    });
                    bot.hasPlayedCard = true;
                    bot.playedThisTrick = true;
                    bot.hand = bot.hand.filter(c => c !== cardToPlay);
                    console.log(`${bot.name}: Followed ${bot.leadSuit} with ${cardToPlay.suit} ${cardToPlay.value}`);
                }
            } catch (error) {
                console.error(`${bot.name}: Error following lead suit:`, error);
            }
        }
    });


    socket.on('bidPlaced', async (data) => {
        // Debug logging
        console.log(`${bot.name}: Received bidPlaced event:`, {
            receivedPlayerId: data.playerId,
            myId: socket.id,
            currentPhase: data.phase,
            myBidStatus: bot.hasBid,
            totalExpectedCards: data.totalExpectedCards,
            highestBidder: data.highestBidder,  // Add this
            hasPlayedCard: bot.hasPlayedCard,
            hasPlayedBidCard: bot.hasPlayedBidCard,
            handLength: bot.hand?.length
        });
    
        // Check for initialization
        if (!bot.isFullyInitialized || bot.hand.length === 0) {
            console.log(`${bot.name}: Ignoring bidPlaced, not fully initialized or no cards`);
            return;
        }
    
        // Update bid winner status immediately if all bids are in
        if (data.totalExpectedCards === 4) {
            bot.isBidWinner = data.highestBidder === socket.id;
            if (bot.isBidWinner) {
                console.log(`${bot.name}: I am the bid winner!`);
            }
        }
    
        // Only proceed with bidding if conditions are met
        if (data.phase === 'bidding-phase' && 
            !bot.hasBid && 
            !bot.bidInProgress &&
            !bot.bidPlacedIds.has(data.playerId)) {
            
            try {
                bot.bidInProgress = true;
                bot.bidPlacedIds.add(data.playerId);
    
                // Add random delay before bidding
                await page.evaluate(() => 
                    new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000))
                );
    
                // Check if we can bid
                const canBid = await page.evaluate(() => {
                    const bidButton = Array.from(document.querySelectorAll('button'))
                        .find(b => b.textContent.includes('Single Bid'));
                    return bidButton && !bidButton.disabled;
                });
    
                if (canBid) {
                    console.log(`${bot.name}: Placing bid...`);
                    
                    // Click bid button
                    await page.evaluate(() => {
                        const bidButton = Array.from(document.querySelectorAll('button'))
                            .find(b => b.textContent.includes('Single Bid'));
                        bidButton.click();
                    });
    
                    bot.hasBid = true;
                    
                    // Wait before playing bid card
                    await page.evaluate(() => 
                        new Promise(resolve => setTimeout(resolve, 1000))
                    );
    
                    // Play bid card if we haven't yet
                    if (!bot.hasPlayedBidCard && bot.hand.length > 0) {
                        const cardToPlay = bot.hand[0];
                        console.log(`${bot.name}: Playing bid card:`, cardToPlay);
    
                        const clicked = await page.evaluate((cardData) => {
                            const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                            const targetCard = cards.find(card => 
                                card.getAttribute('data-suit') === cardData.suit
                            );
                            if (targetCard) {
                                targetCard.click();
                                return true;
                            }
                            return false;
                        }, cardToPlay);
    
                        if (clicked) {
                            bot.hasPlayedBidCard = true;
                            bot.bidCard = cardToPlay;
                            socket.emit('playCard', {
                                playerId: socket.id,
                                card: cardToPlay
                            });
                            bot.hand = bot.hand.filter(c => c !== cardToPlay);
                            console.log(`${bot.name}: Bid card played:`, cardToPlay);
                        }
                    }
                }
            } catch (error) {
                console.error(`${bot.name}: Error in bid sequence:`, error);
            } finally {
                bot.bidInProgress = false;
            }
        }
    });

    // Add these handlers in createBot function
    socket.on('updateBidWinner', (winnerName) => {
        bot.isBidWinner = winnerName === bot.name;
        console.log(`${bot.name}: Bid winner updated:`, {
            winnerName,
            amIWinner: bot.isBidWinner
        });
    });

     // Add cardPlayed handler
     socket.on('cardPlayed', (data) => {
        // Track first played suit
        if (gamePhase === 'playing1-phase' && !bot.leadSuit) {
            bot.leadSuit = data.card.suit;
            console.log(`${bot.name}: Lead suit set to ${bot.leadSuit} by ${data.playerId}`);
        }
    
        // If it's my turn, play a card
        if (data.currentTurn === socket.id && !bot.playedThisTrick) {
            try {
                setTimeout(async () => {
                    // Try to follow suit or play any card if can't follow
                    const cardToPlay = bot.hand.find(card => card.suit === bot.leadSuit) || bot.hand[0];
                    console.log(`${bot.name}: Following ${bot.leadSuit} with:`, cardToPlay);
    
                    const clicked = await page.evaluate((cardData) => {
                        const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                        const targetCard = cards.find(card => 
                            card.getAttribute('data-suit') === cardData.suit
                        );
                        if (targetCard) {
                            targetCard.click();
                            return true;
                        }
                        return false;
                    }, cardToPlay);
    
                    if (clicked) {
                        socket.emit('playCardPlaying1', {
                            playerId: socket.id,
                            card: cardToPlay,
                            phase: 'playing1-phase'
                        });
                        bot.hasPlayedCard = true;
                        bot.playedThisTrick = true;
                        bot.hand = bot.hand.filter(c => c !== cardToPlay);
                        console.log(`${bot.name}: Played ${cardToPlay.suit} ${cardToPlay.value}, remaining:`, bot.hand.length);
                    }
                }, 500);
            } catch (error) {
                console.error(`${bot.name}: Error playing follow card:`, error);
            }
        }
    });

    socket.on('phaseChanged', debounce((phase) => {
        // Remove the problematic early return
        console.log(`${bot.name}: Phase changed from ${bot.currentPhase} to ${phase}`);
        bot.currentPhase = phase;
        bot.lastPhaseChange = Date.now();
    
        if (phase === 'playing1-phase') {
            // Restore bid card to hand
            if (bot.bidCard) {
                bot.hand.push(bot.bidCard);
                console.log(`${bot.name}: Restored bid card to hand:`, bot.bidCard);
                bot.bidCard = null;
            }
            
            // Reset play flags but keep bid winner status
            bot.hasPlayedCard = false;
            bot.playedThisTrick = false;
            bot.leadSuit = null;
            console.log(`${bot.name}: Phase changed to playing1. Hand size: ${bot.hand.length}, Bid winner: ${bot.isBidWinner}`);
        }
    }, 1000));


    socket.on('updateCurrentTurn', debounce((currentTurnId) => {
        const wasMyTurn = bot.currentTurn === socket.id;
        bot.currentTurn = currentTurnId;
        const isMyTurn = currentTurnId === socket.id;
    
        console.log(`${bot.name}: Turn update:`, {
            isMyTurn,
            phase: bot.currentPhase,
            handLength: bot.hand.length,
            isBidWinner: bot.isBidWinner,
            leadSuit: bot.leadSuit
        });
    
        // If it's my turn and I'm bid winner, play first card
        if (isMyTurn && bot.isBidWinner && !bot.playedThisTrick && bot.currentPhase === 'playing1-phase') {
            try {
                // Add small delay before playing
                page.evaluate(() => 
                    new Promise(resolve => setTimeout(resolve, 500))
                ).then(() => {
                    const cardToPlay = bot.hand[0];
                    console.log(`${bot.name}: Leading as bid winner with:`, cardToPlay);
    
                    return page.evaluate((cardData) => {
                        const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                        const targetCard = cards.find(card => 
                            card.getAttribute('data-suit') === cardData.suit
                        );
                        if (targetCard) {
                            targetCard.click();
                            return true;
                        }
                        return false;
                    }, cardToPlay);
                }).then((clicked) => {
                    if (clicked) {
                        socket.emit('playCardPlaying1', {
                            playerId: socket.id,
                            card: cardToPlay,
                            phase: 'playing1-phase'
                        });
                        bot.hasPlayedCard = true;
                        bot.playedThisTrick = true;
                        bot.leadSuit = cardToPlay.suit;
                        bot.hand = bot.hand.filter(c => c !== cardToPlay);
                        console.log(`${bot.name}: Led with ${cardToPlay.suit} ${cardToPlay.value}, setting lead suit`);
                    }
                });
            } catch (error) {
                console.error(`${bot.name}: Error playing lead card:`, error);
            }
        }
    
        // Reset flags on turn change
        if (wasMyTurn !== isMyTurn) {
            if (isMyTurn && bot.currentPhase === 'playing1-phase') {
                bot.hasPlayedCard = false;
            }
        }
    }, 500));


    socket.on('playCardPlaying1', async (data) => {
        // Track lead suit when someone plays a card
        if (!bot.leadSuit && data.card) {
            bot.leadSuit = data.card.suit;
            console.log(`${bot.name}: Lead suit set to ${bot.leadSuit} by ${data.playerId}`);
        }
    
        // Play on my turn if not bid winner
        if (data.currentTurn === socket.id && !bot.isBidWinner && !bot.playedThisTrick) {
            try {
                // Add small delay before playing
                await page.evaluate(() => 
                    new Promise(resolve => setTimeout(resolve, 500))
                );
    
                // Try to follow suit or play any card if can't follow
                const cardToPlay = bot.hand.find(card => card.suit === bot.leadSuit) || bot.hand[0];
                console.log(`${bot.name}: Following ${bot.leadSuit} with:`, cardToPlay);
    
                const clicked = await page.evaluate((cardData) => {
                    const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                    const targetCard = cards.find(card => 
                        card.getAttribute('data-suit') === cardData.suit
                    );
                    if (targetCard) {
                        targetCard.click();
                        return true;
                    }
                    return false;
                }, cardToPlay);
    
                if (clicked) {
                    socket.emit('playCardPlaying1', {
                        playerId: socket.id,
                        card: cardToPlay,
                        phase: 'playing1-phase'
                    });
                    bot.hasPlayedCard = true;
                    bot.playedThisTrick = true;
                    bot.hand = bot.hand.filter(c => c !== cardToPlay);
                    console.log(`${bot.name}: Played ${cardToPlay.suit} ${cardToPlay.value}, remaining:`, bot.hand.length);
                }
            } catch (error) {
                console.error(`${bot.name}: Error playing follow card:`, error);
            }
        }
    });

    
    
    // Reset lead suit when trick completes
    socket.on('trickComplete', () => {
        console.log(`${bot.name}: Trick complete, resetting state`);
        bot.leadSuit = null;
        bot.playedThisTrick = false;
        bot.hasPlayedCard = false;
    });
         

    socket.on('roundComplete', () => {
        console.log(`${bot.name}: Round complete`);
        bot.hasBid = false;
        bot.hasPlayedCard = false;
    });

    socket.on('gameComplete', () => {
        console.log(`${bot.name}: Game complete`);
        bot.hasBid = false;
        bot.hasPlayedCard = false;
        bot.gameStarted = false;
    });

    socket.on('disconnect', (reason) => {
        console.log(`${bot.name}: Disconnected (${reason})`);
        page.close();
    });

    return bot;
}

// 3. Update initializeBots function
async function initializeBots(count = 3) {
    const bots = [];
    let initializationComplete = false;
    
    try {
        for (let i = 2; i <= count + 1; i++) {
            // Create bot
            const bot = await createBot(`Bot${i}`);
            
            // Wait for initialization
            let attempts = 0;
            while (!bot.isFullyInitialized && attempts < bot.maxInitAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
                
                if (attempts % 5 === 0) {
                    console.log(`${bot.name}: Still waiting for initialization... (${attempts}/${bot.maxInitAttempts})`);
                }
            }
            
            if (bot.isFullyInitialized && bot.hand.length > 0) {
                bots.push(bot);
                console.log(`${bot.name}: Successfully initialized with ${bot.hand.length} cards`);
            } else {
                console.error(`${bot.name}: Failed to initialize after ${attempts} attempts`);
                await bot.page.close();
                continue;
            }
            
            // Add delay between bot creations
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        initializationComplete = bots.length === count;
        
        if (initializationComplete) {
            console.log('\nAll bots initialized successfully');
            console.log('Active bots:', bots.map(b => b.name).join(', '));
        } else {
            throw new Error('Not all bots initialized successfully');
        }
        
        return bots;
    } catch (error) {
        console.error('Bot initialization failed:', error);
        // Cleanup any partially initialized bots
        for (const bot of bots) {
            await bot.page.close();
        }
        throw error;
    }
}

module.exports = {
    waitForServer,
    createBot,
    initializeBots
};