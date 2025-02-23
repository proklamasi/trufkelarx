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

    if (!sharedBrowser) {
        sharedBrowser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox']
        });
    }
        
    const page = await sharedBrowser.newPage();
    page.setDefaultNavigationTimeout(60000);
    
    const bot = { 
        name: botName,
        socket: socket,
        page: page,
        players: [],
        playerIndex: -1,
        hasBid: false,
        hasPlayedCard: false,
        hasPlayedBidCard: false,
        gameStarted: false,
        bidInProgress: false,
        allBidsPlaced: false,
        currentPhase: 'waiting',
        isMyTurn: false,
        lastPhaseChange: 0,
        lastTurnUpdate: 0,
        bidPlacedIds: new Set(),
        lastBidTime: 0,
        isFullyInitialized: false,
        initializationTime: Date.now(),
        minInitDelay: 5000,
        maxInitAttempts: 30,
        initAttempts: 0,
        hand: [],
        waitingForStart: true,
        currentTurn: null,
        lastCardPlayTime: 0,
        minPlayDelay: 1000,
        lastPlayingPhaseUpdate: 0,
        playingPhaseDelay: 2000,
        leadSuit: null,
        playedThisTrick: false,
        bidCard: null,
        lastBidWinnerUpdate: null,
        trufSuit: null,
        gameMode: null,
        isBidWinner: false,
        lastBidWinnerUpdate: null
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

        // Event Handlers
        // Add to gameStarted handler after setting hand
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
                    bot.players = gameState.players.map(p => p.name);
                    bot.playerIndex = bot.players.indexOf(bot.name);
                    bot.isFullyInitialized = true;
                    console.log(`${bot.name}: Game started with ${bot.hand.length} cards`);
                    console.log(`${bot.name}: Players order:`, bot.players);
                }
            } catch (error) {
                console.error(`${bot.name}: Error handling game start:`, error);
            }
        });

        socket.on('bidPlaced', async (data) => {
            if (!bot.isFullyInitialized || bot.hand.length === 0) return;

            if (data.phase === 'bidding-phase' && 
                !bot.hasBid && 
                !bot.bidInProgress &&
                !bot.bidPlacedIds.has(data.playerId)) {
                
                try {
                    bot.bidInProgress = true;
                    bot.bidPlacedIds.add(data.playerId);
                    
                    await page.evaluate(() => 
                        new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500))
                    );

                    const canBid = await page.evaluate(() => {
                        const bidButton = Array.from(document.querySelectorAll('button'))
                            .find(b => b.textContent.includes('Single Bid'));
                        return bidButton && !bidButton.disabled;
                    });

                    if (canBid) {
                        await page.evaluate(() => {
                            const bidButton = Array.from(document.querySelectorAll('button'))
                                .find(b => b.textContent.includes('Single Bid'));
                            bidButton.click();
                        });

                        bot.hasBid = true;
                        
                        const cardToPlay = bot.hand[0];
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
                                pileIds: `bottomPile`,  // Add this
                                card: cardToPlay,
                            });
                            bot.hand = bot.hand.filter(c => c !== cardToPlay);
                            console.log(`${bot.name}: Bid card played:`, cardToPlay);
                        }
                    }
                } catch (error) {
                    console.error(`${bot.name}: Error in bid sequence:`, error);
                } finally {
                    bot.bidInProgress = false;
                }
            }
        });

        socket.on('updateTrufSuit', (trufSuit) => {
            bot.trufSuit = trufSuit;
            console.log(`${bot.name}: Truf suit updated to ${trufSuit}`);
        });
        
        socket.on('updateGameMode', (mode) => {
            bot.gameMode = mode;
            console.log(`${bot.name}: Game mode updated to ${mode}`);
        });

        // Modify updateBidWinner handler
        socket.on('updateBidWinner', (winnerName) => {
            // Prevent duplicate updates within 1 second
            const now = Date.now();
            if (bot.lastBidWinnerUpdate && (now - bot.lastBidWinnerUpdate) < 1000) {
                console.log(`${bot.name}: Ignoring duplicate bid winner update`);
                return;
            }
            
            bot.lastBidWinnerUpdate = now;
            bot.isBidWinner = winnerName === bot.name;
            console.log(`${bot.name}: Bid winner updated:`, {
                winnerName,
                amIWinner: bot.isBidWinner,
                timestamp: now
            });
        });

        // Add helper function at the top level
        function isValidCardPlay(card, hand, leadSuit) {
            // If no lead suit, any card is valid
            if (!leadSuit) return true;
            
            // If card matches lead suit, it's valid
            if (card.suit === leadSuit) return true;
            
            // If player has no cards of lead suit, any card is valid
            const hasLeadSuit = hand.some(c => c.suit === leadSuit);
            return !hasLeadSuit;
        }

        // Add helper to check if piles are empty
        function arePilesEmpty(page) {
            return page.evaluate(() => {
                const piles = ['bottomPile', 'leftPile', 'topPile', 'rightPile'];
                return piles.every(pileId => {
                    const pile = document.getElementById(pileId);
                    return pile && pile.children.length === 0;
                });
            });
        }



        function getValidCard(bot) {
            // First player in playing1-phase
            if (bot.currentPhase === 'playing1-phase' && !bot.leadSuit) {
                // Try to find a non-truf card first
                const nonTrufCards = bot.hand.filter(card => card.suit !== bot.trufSuit);
                if (nonTrufCards.length > 0) {
                    return nonTrufCards[0];
                }
                // If only has truf cards, then can play truf
                return bot.hand[0];
            }
        
            // Follow lead suit if possible
            if (bot.leadSuit) {
                const followSuitCards = bot.hand.filter(card => card.suit === bot.leadSuit);
                if (followSuitCards.length > 0) {
                    return followSuitCards[0];
                }
            }
        
            // If can't follow suit, can play any card
            return bot.hand[0];
        }

        // In phaseChanged (first play of trick - empty piles)
        socket.on('phaseChanged', debounce(async (phase) => {
            if (phase === 'playing1-phase' && bot.isBidWinner) {
                try {
                    const pilesEmpty = await arePilesEmpty(page);
                    console.log('Piles are empty:', pilesEmpty);
                    if (!pilesEmpty) {
                        console.log(`${bot.name}: Skipping phaseChanged play - piles not empty`);
                        return;
                    }

                        console.log(`${bot.name}: Attempting to play as bid winner`);
                        
                        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 1500)));
                        
                        const cardToPlay = getValidCard(bot);
                        console.log(`${bot.name}: Selected card to play:`, cardToPlay);
                    
                        const clicked = await page.evaluate((cardData) => {
                            console.log('Finding card:', cardData);
                            const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                            console.log('Available cards:', cards.map(c => ({
                                suit: c.getAttribute('data-suit'),
                                value: c.getAttribute('data-value')
                            })));
                            
                            const targetCard = cards.find(card => 
                                card.getAttribute('data-suit') === cardData.suit  // Only check suit like in bidPlaced
                            );
                            
                            if (targetCard) {
                                targetCard.click();
                                return true;
                            }
                            console.log('Card not found:', cardData);
                            return false;
                        }, cardToPlay);
                    
                        console.log(`${bot.name}: Click result:`, clicked);
                    
                        // In phaseChanged handler (for bid winner's first play)
                        if (clicked) {
                            socket.emit('playCardPlaying1', {
                                playerId: socket.id,
                                pileIds: 'bottomPile',  // Changed from 'player1Pile'
                                card: cardToPlay,
                                phase: bot.currentPhase
                            });
                            bot.playedThisTrick = true;
                            bot.hand = bot.hand.filter(c => c !== cardToPlay);
                            console.log(`${bot.name}: Led with ${cardToPlay.suit} ${cardToPlay.value}`);
                        }
                    } catch (error) {
                        console.error(`${bot.name}: Error playing as bid winner:`, error);
                }
            }
        }, 1000));

        // REMOVE the cardPlayed handler entirely

        // Add this handler before phaseChanged
        socket.on('cardPlayed', (data) => {
            // Set lead suit when it's the first card of the trick
            if (bot.currentPhase === 'playing1-phase') {
                if (!bot.leadSuit) {
                    bot.leadSuit = data.card.suit;
                    console.log(`${bot.name}: Lead suit set to ${bot.leadSuit} from ${data.playerId}`);
                }
                console.log(`${bot.name}: Card played by ${data.playerId}: ${data.card.suit} ${data.card.value}`);
            }
        });

        // In updateCurrentTurn - only play if at least one pile has cards
        socket.on('updateCurrentTurn', debounce(async (currentTurnId) => {
            // Get current player name from turn ID
            const currentPlayerName = bot.players[currentTurnId] || 'unknown';
            const isMyTurn = currentPlayerName === bot.name;

            if (isMyTurn && !bot.playedThisTrick && bot.currentPhase === 'playing1-phase') {
                try {
                    const pilesEmpty = await arePilesEmpty(page);
                    if (pilesEmpty) {
                        console.log(`${bot.name}: Skipping turn - waiting for first play`);
                        return;
                    }                    
                    
                    const cardToPlay = getValidCard(bot); // This will use leadSuit from cardPlayed event
        
                    const clicked = await page.evaluate((cardData) => {
                        console.log('Finding card:', cardData);
                        const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                        console.log('Available cards:', cards.map(c => ({
                            suit: c.getAttribute('data-suit'),
                            value: c.getAttribute('data-value')
                        })));
                        
                        const targetCard = cards.find(card => 
                            card.getAttribute('data-suit') === cardData.suit  // Only check suit like in bidPlaced
                        );
                        
                        if (targetCard) {
                            targetCard.click();
                            return true;
                        }
                        console.log('Card not found:', cardData);
                        return false;
                    }, cardToPlay);
        
                    console.log(`${bot.name}: Click result:`, clicked);
        
                    // And in updateCurrentTurn handler
                    if (clicked) {
                        socket.emit('playCardPlaying1', {
                            playerId: socket.id,
                            pileIds: 'bottomPile',  // Changed from 'player1Pile'
                            card: cardToPlay,
                            phase: bot.currentPhase
                        });
                        bot.playedThisTrick = true;
                        bot.hand = bot.hand.filter(c => c !== cardToPlay);
                        console.log(`${bot.name}: Played with ${cardToPlay.suit} ${cardToPlay.value}`);
                    }
                } catch (error) {
                    console.error(`${bot.name}: Error playing card:`, error);
                }
            } else {
                console.log(`${bot.name}: Not playing this turn, current player: ${currentPlayerName}`);
            }
        }, 500));
        
        socket.on('trickComplete', () => {
            console.log(`${bot.name}: Trick complete, resetting state`);
            bot.leadSuit = null;
            bot.playedThisTrick = false;
            bot.hasPlayedCard = false;
        });

        return bot;

    } catch (error) {
        console.error(`${botName}: Error initializing -`, error);
        await page.close();
        throw error;
    }
}

async function initializeBots(count = 3) {
    const bots = [];
    let initializationComplete = false;
    
    try {
        for (let i = 2; i <= count + 1; i++) {
            const bot = await createBot(`Bot${i}`);
            
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