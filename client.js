// Initialize socket
const socket = io();

// DOM ready handler
document.addEventListener('DOMContentLoaded', () => {
    initializeBidBox();
});

// Initialize bid box container
function initializeBidBox() {
    const bidBox = document.getElementById('bidBox');
    if (!bidBox) {
        console.error('Bid box not found');
        return;
    }

    // Clear existing content and create fresh structure
    bidBox.innerHTML = `
        <div class="bid-header">
            <span class="player-col">Player</span>
            <span class="bid-col">Bid</span>
        </div>
        <div id="bidValues" class="bid-values"></div>
    `;
}

// Update bid values handler
socket.on('updatePlayerNamesAndBidValues', (data) => {
    console.log('Received bid data:', data); // Debug log

    try {
        const bidValuesDiv = document.getElementById('bidValues');
        if (!bidValuesDiv) {
            console.error('Bid values container not found');
            initializeBidBox(); // Try to recreate the container
            return;
        }

        // Clear and update
        bidValuesDiv.innerHTML = '';
        const { playerNames = [], bidValues = [] } = data;

        playerNames.forEach((name, index) => {
            const bidRow = document.createElement('div');
            bidRow.className = 'bid-row';
            const bidValue = bidValues[index] ?? 0; // Use nullish coalescing
            
            bidRow.innerHTML = `
                <span class="player-col">${name || 'Unknown'}</span>
                <span class="bid-col">${bidValue}</span>
            `;
            bidValuesDiv.appendChild(bidRow);
        });
    } catch (error) {
        console.error('Error updating bid values:', error, data);
    }
});

// Add debug listener
socket.on('gameUpdated', (gameState) => {
    console.log('Game state updated:', gameState);
});
