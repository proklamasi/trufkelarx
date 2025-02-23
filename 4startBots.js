const { initializeBots, waitForServer } = require('./bots.js');

async function startBots() {
    try {
        await waitForServer('http://localhost:3000');
        const bots = await initializeBots(3);
        console.log('Bots initialized successfully');
        console.log(`Active bots: ${bots.map(b => b.name).join(', ')}`);
    } catch (error) {
        console.error('Failed to initialize bots:', error);
    }
}

startBots();