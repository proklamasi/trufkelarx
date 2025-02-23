const { createBot, waitForServer } = require('./bots.js');

async function startBots() {
    try {
        await waitForServer('http://localhost:3000');
        console.log('Starting bot initialization...\n');
        
        // Initialize all bots first
        const bots = [];
        for (let i = 2; i <= 4; i++) {
            try {
                const bot = await createBot(`Bot${i}`);
                bots.push(bot);
                console.log(`${bot.name}: Connected and ready`);
            } catch (error) {
                console.error(`Failed to initialize Bot${i}:`, error);
            }
        }

        if (bots.length === 0) {
            throw new Error('No bots were initialized successfully');
        }

        console.log('\nWaiting for all bots to receive cards...');
        
        // Wait for all bots to receive their cards
        await Promise.all(bots.map(bot => 
            new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error(`${bot.name} timeout waiting for cards`));
                }, 30000); // 30 second timeout

                const checkInterval = setInterval(() => {
                    if (bot.hand && bot.hand.length > 0) {
                        clearInterval(checkInterval);
                        clearTimeout(timeout);
                        console.log(`${bot.name}: Received ${bot.hand.length} cards`);
                        resolve();
                    }
                }, 1000);

                // Also listen for gameStarted event
                bot.socket.on('gameStarted', (gameState) => {
                    const player = gameState.players.find(p => p.name === bot.name);
                    if (player?.hand) {
                        bot.hand = player.hand;
                        bot.gameStarted = true;
                        bot.isFullyInitialized = true;
                    }
                });
            })
        ));

        console.log('\nAll bots initialized with cards');
        console.log(`Active bots: ${bots.map(b => b.name).join(', ')}`);
        return bots;

    } catch (error) {
        console.error('Failed to start bots:', error);
        // Close browser pages for all bots
        for (const bot of bots || []) {
            try {
                await bot.page.close();
            } catch (e) {
                console.error(`Error closing page for ${bot.name}:`, e);
            }
        }
        process.exit(1);
    }
}

startBots();