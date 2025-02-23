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
        discardPile: [],
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

        // Add helper function to wait for first played card
        async function waitForFirstPlayedCard(page) {
            // Try up to 3 times with 500ms delay between attempts
            for (let attempts = 0; attempts < 3; attempts++) {
                const firstCard = await page.evaluate(() => {
                    const pileCard = document.querySelector('.pile .card');
                    if (pileCard) {
                        return {
                            suit: pileCard.getAttribute('data-suit'),
                            value: pileCard.getAttribute('data-value')
                        };
                    }
                    return null;
                });

                // perubahan
                let firstPlayedCard = null;
                if ((!bot.isBidWinner || !bot.isRoundWinner) && !firstPlayedCard) {
                    console.log('First played card found:', firstCard);
                    return firstCard;
                }

                // Wait before next attempt
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log('No first played card found after retries');
            return null;
        }


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

        socket.on('updateBidWinner', (winnerName) => {
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

        // Add roundWinner handler
        socket.on('roundWinner', (data) => {  
            bot.playedThisTrick = false;
            bot.leadSuit = null;
            bot.isBidWinner = false;  // No longer bid winner's turn
            bot.isRoundWinner = data.winnerName === bot.name;  // Track round winner
            
            console.log(`${bot.name}: Round winner:`, {
                winner: data.winnerName,
                amIWinner: bot.isRoundWinner,
                winningCard: data.winningCard
            });
        });

        function arePilesEmpty(page) {
            return page.evaluate(() => {
                const piles = ['bottomPile', 'leftPile', 'topPile', 'rightPile'];
                return piles.every(pileId => {
                    const pile = document.getElementById(pileId);
                    return pile && pile.children.length === 0;
                });
            });
        }

        socket.on('cardPlayed', (data) => {
            if (bot.currentPhase === 'playing1-phase') {
                if (!bot.leadSuit) {
                    bot.leadSuit = data.card.suit;
                    console.log(`${bot.name}: Lead suit set to ${bot.leadSuit} from ${data.playerId}`);
                }
                console.log(`${bot.name}: Card played by ${data.playerId}: ${data.card.suit} ${data.card.value}`);
            }
        });


        // Bot-side code
        socket.on('updateDiscardPile', (discardPile) => {
            bot.discardPile = discardPile; // Update the bot's discard pile
            //console.log(`${bot.name}: Discard pile updated:`, discardPile);
        });

        // perubahan
        function getLowestValueCard(cards) {
            if (!cards || cards.length === 0) {
                console.log('No cards available to play');
                return null;
            }
            return cards.reduce((lowest, card) => 
                card.bidValue < lowest.bidValue ? card : lowest
            );
        }

        // perubahan
        function getValidCard(bot, firstPlayedSuit) {
            //last card
            if (!bot.hand || bot.hand.length === 0) {
                console.log(`${bot.name}: No cards left in hand`);
                return null;
            }

            // Leading play (no first played suit)
            if (!firstPlayedSuit) {
                console.log(`${bot.name}: Leading play`);
                
                // Check if bot has non-truf cards
                const nonTrufCards = bot.hand.filter(card => card.suit !== bot.trufSuit);
                

                // First round rules
                if (bot.discardPile.length === 0) {
                    // Must play non-truf if available
                    if (nonTrufCards.length > 0) {
                        const cardToPlay = getLowestValueCard(nonTrufCards);
                        console.log(`${bot.name}: First round - playing non-truf:`, cardToPlay);
                        return cardToPlay;
                    }
                    // Only has truf cards
                    console.log(`${bot.name}: First round - only has truf cards`);
                    return getLowestValueCard(bot.hand);
                }
                
                // Subsequent rounds - check if can play truf
                const hasTrufBeenPlayed = bot.discardPile.some(card => 
                    card.card.suit === bot.trufSuit);
                const hasDifferentSuits = bot.discardPile.slice(-4).some(card => 
                    card.card.suit !== bot.discardPile[bot.discardPile.length - 1].card.suit);
                
                if (hasTrufBeenPlayed || hasDifferentSuits) {
                    // Can play any card
                    const cardToPlay = getLowestValueCard(bot.hand);
                    console.log(`${bot.name}: Can play any card:`, cardToPlay);
                    return cardToPlay;
                } else {
                    // Should play non-truf if possible
                    if (nonTrufCards.length > 0) {
                        const cardToPlay = getLowestValueCard(nonTrufCards);
                        console.log(`${bot.name}: Playing non-truf:`, cardToPlay);
                        return cardToPlay;
                    }
                    return getLowestValueCard(bot.hand);
                }
            }
        
            // Following play - must follow suit if possible
            const followSuitCards = bot.hand.filter(card => card.suit === firstPlayedSuit);
            if (followSuitCards.length > 0) {
                const cardToPlay = getLowestValueCard(followSuitCards);
                console.log(`${bot.name}: Following suit with:`, cardToPlay);
                return cardToPlay;
            }
        
            // Can't follow suit - check if can play truf
            const trufCards = bot.hand.filter(card => card.suit === bot.trufSuit);
            if (trufCards.length > 0) {
                const cardToPlay = getLowestValueCard(trufCards);
                console.log(`${bot.name}: Can't follow suit, playing truf:`, cardToPlay);
                return cardToPlay;
            }
        
            // Can't follow suit or play truf - play lowest card
            const cardToPlay = getLowestValueCard(bot.hand);
            console.log(`${bot.name}: Can't follow suit or play truf, playing:`, cardToPlay);
            return cardToPlay;
        }


        // Add phaseChanged handler back
        socket.on('phaseChanged', (phase) => {
            console.log(`${bot.name}: Phase changed from ${bot.currentPhase} to ${phase}`);
            bot.currentPhase = phase;  // Set the phase immediately
            if (bot.currentPhase === 'playing1-phase') {
                // Always restore bid card at phase start
                if (bot.bidCard) {
                    bot.hand.push(bot.bidCard);
                    console.log(`${bot.name}: Restored bid card to hand:`, bot.bidCard);
                    bot.bidCard = null;
                }
            }
        });
        
        // Add after other socket handlers
        socket.on('updateCurrentTurn', debounce(async (currentTurnId) => {
            if (bot.currentPhase === 'playing1-phase') {
                const myIndex = bot.players.indexOf(bot.name);
                console.log(`${bot.name} (position ${myIndex}):`, {
                    allPlayers: bot.players,
                    myPosition: myIndex,
                    currentTurn: currentTurnId,
                    phase: bot.currentPhase
                });
            if (bot.currentPhase === 'playing1-phase') {
                const myIndex = bot.players.indexOf(bot.name);
                console.log(myIndex, bot.players);
        
                if (bot.bidCard) {
                    bot.hand.push(bot.bidCard);
                    console.log(`${bot.name}: Restored bid card to hand:`, bot.bidCard);
                    bot.bidCard = null;
                }
        
                const nextIndex = (myIndex + 1) % bot.players.length;
                const nextPlayer = bot.players[nextIndex];
        
                if ((bot.isBidWinner || nextPlayer) && !bot.playedThisTrick) {
                    try {
                        //let firstPlayedCard = null;
        
                        if (bot.roundWinner && !nextPlayer) {
                            const pilesEmpty = await arePilesEmpty(bot.page);
                            if (!pilesEmpty) {
                                console.log(`${bot.name}: Skipping - already played first card`);
                                return;
                            }
                            console.log(`${bot.name}: Leading as round winner`);
                        } else {
                            firstPlayedCard = await waitForFirstPlayedCard(bot.page);
                        }
        
                        const firstPlayedSuit = firstPlayedCard ? firstPlayedCard.suit : null;
                        const cardToPlay = getValidCard(bot, firstPlayedSuit);
        
                        if (cardToPlay && !bot.playedThisTrick) {
                            const clicked = await bot.page.evaluate((cardData) => {
                                const cards = Array.from(document.querySelectorAll('.card:not(.disabled)'));
                                const targetCard = cards.find(card => {
                                    const cardValue = card.src.match(/(\w+)_of_/)?.[1] || '';
                                    const cardSuit = card.getAttribute('data-suit');
                                    return cardSuit === cardData.suit && cardValue === cardData.value;
                                });
                                if (targetCard) {
                                    targetCard.click();
                                    return true;
                                }
                                return false;
                            }, cardToPlay);
        
                            if (clicked) {
                                bot.socket.emit('playCardPlaying1', {
                                    playerId: bot.socket.id,
                                    card: cardToPlay,
                                    phase: bot.currentPhase
                                });
                                bot.playedThisTrick = true;
                                bot.hand = bot.hand.filter(c => c !== cardToPlay);
                                console.log(`${bot.name}: ${bot.roundWinner === bot.name ? 'Led with' : 'Played'} ${cardToPlay.suit} ${cardToPlay.value}`);
                            } else {
                                console.log(`${bot.name}: Failed to click card ${cardToPlay.suit} ${cardToPlay.value}`);
                            }
                        }
                    } catch (error) {
                        console.error(`${bot.name}: Error playing card:`, error);
                    }
                }
            }
        }
    }), 500);


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