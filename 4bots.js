const puppeteer = require('puppeteer');
const io = require('socket.io-client');

let sharedBrowser = null;

async function waitForServer(url, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const response = await fetch(url);
            if (response.ok) return true;
        } catch (error) {
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
            headless: false,
            args: [
                '--disable-features=site-per-process',
                '--start-maximized'
            ]
        });
    }
    
    const page = await sharedBrowser.newPage();
    page.setDefaultNavigationTimeout(60000);
    
    const bot = { 
        name: botName,
        hand: [],
        socket: socket,
        page: page,
        hasBid: false,
        hasPlayedCard: false,
        gameStarted: false
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

        socket.on('gameStarted', async (gameState) => {
        if (bot.gameStarted) {
            console.log(`${bot.name}: Already in game, ignoring duplicate start`);
            return;
        }
        bot.gameStarted = true;
        
        console.log(`\n${bot.name}: Game started`);
        
        const player = gameState.players.find(p => p.name === bot.name);
        if (player && !bot.hasBid) {
            bot.hand = player.hand;
            console.log(`${bot.name}: Received ${bot.hand.length} cards`);
            
            // Wait before placing bid
            setTimeout(async () => {
                try {
                    // Click the Single Bid button
                    await page.evaluate(() => {
                        const buttons = Array.from(document.querySelectorAll('button'));
                        const bidButton = buttons.find(b => b.textContent.includes('Single Bid'));
                        if (bidButton) bidButton.click();
                    });
                    
                    console.log(`${bot.name}: Clicked Single Bid button`);
                    
                    // Place the bid
                    socket.emit('placeBid', {
                        playerId: socket.id,
                        type: 'singleBid',
                        bid: 1
                    });
                    
                    bot.hasBid = true;
                } catch (error) {
                    console.error(`${bot.name}: Error placing bid -`, error);
                }
            }, 1000 + Math.random() * 2000);
        }
    });
    
        socket.on('bidPlaced', async (data) => {
        if (!bot.hasPlayedCard && bot.hand && bot.hand.length > 0) {
            setTimeout(async () => {
                try {
                    const cardToPlay = bot.hand[0];
                    console.log(`${bot.name}: Playing bidding card:`, cardToPlay);
    
                    // Find and click card in UI
                    const clicked = await page.evaluate((cardData) => {
                        // Use correct selector #playerHand
                        const playerHand = document.querySelector('#playerHand');
                        if (!playerHand) {
                            console.log('Player hand container not found (#playerHand)');
                            return false;
                        }
    
                        // Get all cards in hand
                        const cards = Array.from(playerHand.querySelectorAll('.card'));
                        console.log('Found cards in hand:', cards.length);
    
                        // Find matching card by data attributes
                        const targetCard = cards.find(card => {
                            const suit = card.getAttribute('data-suit');
                            const value = card.dataset.index; // Using index as cards don't have value attribute
                            console.log('Checking card:', { suit, index: value });
                            return suit === cardData.suit;
                        });
    
                        if (targetCard) {
                            console.log('Found matching card, clicking...');
                            targetCard.click();
                            return true;
                        }
    
                        console.log('No matching card found');
                        return false;
                    }, cardToPlay);
    
                    if (clicked) {
                        socket.emit('playCard', {
                            playerId: socket.id,
                            card: cardToPlay
                        });
                        
                        bot.hasPlayedCard = true;
                        bot.hand = bot.hand.slice(1);
                        console.log(`${bot.name}: Card played, remaining cards:`, bot.hand.length);
                    } else {
                        console.error(`${bot.name}: Failed to click card in UI`);
                        console.error(`${bot.name}: Attempted to play:`, cardToPlay);
                    }
                } catch (error) {
                    console.error(`${bot.name}: Error playing bidding card -`, error);
                    console.error(error.stack);
                }
            }, 1000 + Math.random() * 2000);
        }
    });

    socket.on('cardPlayed', (data) => {
        if (data.playerId === socket.id) {
            bot.hand = bot.hand.filter(card => 
                card.suit !== data.card.suit || card.value !== data.card.value
            );
            console.log(`${bot.name}: Card played and confirmed, ${bot.hand.length} cards remaining`);
            bot.hasPlayedCard = false;
        }
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

async function initializeBots(count = 3) {
    console.log(`\nInitializing ${count} bots in single browser window...`);
    const bots = [];
    
    for (let i = 2; i <= count + 1; i++) {
        try {
            await new Promise(resolve => setTimeout(resolve, 3000));
            const bot = await createBot(`Bot${i}`);
            bots.push(bot);
            console.log(`Bot${i}: Initialization complete`);
        } catch (error) {
            console.error(`Failed to create Bot${i}:`, error);
        }
    }

    process.on('SIGINT', async () => {
        console.log('\nClosing shared browser...');
        if (sharedBrowser) {
            await sharedBrowser.close();
        }
        process.exit();
    });

    if (bots.length === 0) {
        throw new Error('No bots were successfully created');
    }

    console.log('\nBot initialization summary:');
    console.log('-------------------------');
    bots.forEach(bot => {
        console.log(`${bot.name}: Ready`);
    });
    console.log('-------------------------\n');

    return bots;
}

module.exports = {
    createBot,
    initializeBots,
    waitForServer
};