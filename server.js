const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TrufGame = require('./game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

let game = new TrufGame();


function calculateExpectedCards(game) {
    // First check if all players have bid
    if (!game.players.every(p => p.bidType)) {
        console.log('Not all players have bid yet');
            return false;
        }

    const total = game.players.reduce((total, player) => {
        console.log(`Adding for ${player.name} with bid ${player.bidType}`);
        if (player.bidType === 'singleBid') return total + 1;
        if (player.bidType === 'doubleBids' || player.bidType === 'noTrumps') return total + 2;
        return total;
    }, 0);

    console.log(`Total expected cards from all players: ${total}`);
    return total;
}

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('joinGame', (playerName) => {
        if (game.isUsernameTaken(playerName)) {
            socket.emit('joinGameError', 'Username already taken. Please choose another name.');
            return;
        }
        const success = game.addPlayer({ id: socket.id, name: playerName });
        if (success) {
            console.log('Player added:', game.getGameState().players);
            socket.emit('joinGameSuccess'); // Emit success event to the joining client
            io.emit('gameUpdated', game.getGameState()); // Update all clients
        }
    });

    socket.on('startGame', () => {
        if (game.players.length === 4) {
            game.startGame();
            io.emit('gameStarted', game.getGameState());
        } else {
            console.error('Cannot start game: exactly 4 players are required');
        }
    });


    // Add before socket events
    function areAllBidsPlaced(game) {
        return game.players.every(player => player.bidType);
    }

    socket.on('placeBid', (data) => {
        const player = game.players.find(p => p.id === socket.id);
        if (!player) return;

        console.log(`Player ${player.name} placing bid: ${data.type}`);
        player.bidType = data.type;

        console.log('Current bid types:');
        game.players.forEach(p => {
            console.log(`- ${p.name}: ${p.bidType || 'not set'}`);
        });

        io.emit('bidPlaced', {
            playerId: socket.id,
            bidType: data.type
        });
    });

    // Check if all players have bid
    if (areAllBidsPlaced(game)) {
        console.log('All players have placed bids');
        game.biddingComplete = true;
    }

socket.on('playCard', (data) => {
    const playerIndex = game.players.findIndex(player => player.id === data.playerId);
    if (playerIndex === -1) return;

    if (game.phase !== 'bidding-phase') return;

    const currentPlayer = game.players[playerIndex];
    console.log(`Player ${currentPlayer.name} playing card:`, data.card);

    // Validate double bid rules
    if (currentPlayer.bidType === 'doubleBids') {
        const isValidDoubleBid = game.validateDoubleBid(playerIndex, data.card);
        if (!isValidDoubleBid) {
            socket.emit('playCardError', 'Double bid must have same suit and sum >= 7');
            return;
        }
    }

    // Check if player already played maximum cards
    const playerCards = game.pile.filter(p => p.playerIndex === playerIndex);
    const maxCards = currentPlayer.bidType === 'doubleBids' || currentPlayer.bidType === 'noTrumps' ? 2 : 1;

    if (playerCards.length >= maxCards) {
        console.log(`Player ${currentPlayer.name} already played maximum cards`);
        return;
    }

    const cardIndex = currentPlayer.hand.findIndex(card => 
        card.value === data.card.value && card.suit === data.card.suit
    );
    if (cardIndex === -1) return;

    currentPlayer.hand.splice(cardIndex, 1);

    const pileIds = [
        'bottomPile', 'rightPile', 'topPile', 'leftPile',
        'bottomExtraPile', 'rightExtraPile', 'topExtraPile', 'leftExtraPile'
    ];

    // Emit card to all players with correct perspective
    game.players.forEach((targetPlayer, index) => {
        const offset = data.isExtraPile ? 4 : 0;
        const perspectivePileId = pileIds[offset + ((index - playerIndex + 4) % 4)];
        console.log(`Emitting card from ${currentPlayer.name} to ${targetPlayer.name} at pile ${perspectivePileId}`);
        
        io.to(targetPlayer.id).emit('cardPlayed', {
            pileIds: perspectivePileId,
            card: data.card,
            faceUp: false,
            isExtraPile: data.isExtraPile,
            playerName: currentPlayer.name
        });
    });

    // Add card to game pile
    game.pile.push({
        card: data.card,
        playerIndex,
        originalIndex: cardIndex,
        isExtraPile: data.isExtraPile,
        playerName: currentPlayer.name
    });

    console.log('Current pile length:', game.pile.length);

    // Check for flip condition if all bids are placed
    const expectedCards = calculateExpectedCards(game);
    if (expectedCards && game.pile.length === expectedCards) {
        console.log(`All ${expectedCards} cards received, flipping cards`);
        
        setTimeout(() => {
            // First flip all cards
            game.pile.forEach(({ card, playerIndex, isExtraPile }) => {
                game.players.forEach((player, index) => {
                    const offset = isExtraPile ? 4 : 0;
                    const perspectivePileId = pileIds[offset + ((index - playerIndex + 4) % 4)];
                    io.to(player.id).emit('cardFlipped', {
                        pileIds: perspectivePileId,
                        card,
                        faceUp: true,
                        isExtraPile
                    });
                });
            });

            // Then handle bid resolution after delay
            setTimeout(() => {
                if (game.pile.length > 0) {
                    // Calculate initial bid values
                    const bidResult = game.calculateBidValues(game.pile);
                    
                    // Store original values without modification
                    game.initialBidValues = bidResult.bids.map(bid => bid.value);
                    console.log('Original bid values:', game.initialBidValues);

                    // Display values including total
                    const playerNames = bidResult.bids.map(bid => bid.name);
                    const displayBidValues = [...game.initialBidValues];
                    
                    io.emit('updatePlayerNamesAndBidValues', { 
                        playerNames, 
                        bidValues: displayBidValues 
                    });

                    // Emit game mode update
                    io.emit('updateGameMode', bidResult.gameMode);
                    console.log('Game mode:', bidResult.gameMode);


                    // Find highest bid
                    const highestBidRankCard = game.pile.reduce((highest, current) => {
                        return current.card.bidRank > highest.card.bidRank ? current : highest;
                    }, game.pile[0]);

                    // Determine the game mode based on the sum of bid values
                    //const bidValueSum = bidValues.reduce((sum, value) => sum + value, 0);
                    const bidValueSum = bidResult.total;
                    console.log('Total bid value:', bidValueSum);
                    if (bidValueSum === 13) {
                        console.log('Bid value sum is 13, highest bid wins');
                        const bidWinner = game.players[highestBidRankCard.playerIndex];
                        console.log(`Highest bid from ${bidWinner.name} with card:`, highestBidRankCard.card);
                        game.bidWinner = bidWinner;
                        io.emit('updateGameMode', 'Pas');
                        io.emit('updateBidWinner', bidWinner.name);
                        io.to(bidWinner.id).emit('showChooseGameModeButtons');
                    } else {
                        let gameMode = bidValueSum < 13 ? 'Main Bawah' : 'Main Atas';
                        const bidWinner = game.players[highestBidRankCard.playerIndex];
                        game.bidWinner = bidWinner;
                        io.emit('updateBidWinner', bidWinner.name);
                        io.emit('updateGameMode', gameMode);
                        
                        // Move this block up here and remove the duplicate below
                        game.gameMode = gameMode;
                        game.phase = 'playing1-phase';
                        game.currentTurn = game.bidWinner;  // Set current turn to bid winner
                        io.emit('phaseChanged', game.phase);
                        io.emit('updateCurrentTurn', game.bidWinner.id);  // Notify clients about the current turn
                    }

                    // Update truf suit
                    const trufSuit = highestBidRankCard.card.suit;
                    game.setTrumpSuit(trufSuit);
                    io.emit('updateTrufSuit', trufSuit);

                    // Return cards to hands
                    game.pile.forEach(({ card, playerIndex, originalIndex }) => {
                        game.players[playerIndex].hand.splice(originalIndex, 0, card);
                    });

                    // Update game state
                    io.emit('updateHands', game.getGameState().players);
                    io.emit('clearPiles');
                    game.pile = [];

                    // Set winner and phase
                    game.bidWinner = game.players[highestBidRankCard.playerIndex];
                    game.phase = 'playing1-phase';
                    game.currentTurn = game.bidWinner;
                    
                    // Emit final updates
                    io.emit('updateBidWinner', game.bidWinner.name);
                    io.emit('phaseChanged', game.phase);
                    io.emit('updateCurrentTurn', game.currentTurn.id);
                }
            }, 3000);
        }, 2000);
    }
}); // Close playCard event handler

socket.on('playCardError', (message) => {
    alert(message); // Or update UI to show error
});

socket.on('chooseGameMode', (data) => {
    const gameMode = data.gameMode;
    game.gameMode = gameMode;

    console.log('Before update:', {
        gameMode,
        initialValues: game.initialBidValues,
        phase: game.phase
    });
    
    let updatedValues;
    if (gameMode === 'Main Atas') {
        updatedValues = [...game.initialBidValues].map(value => value + 1);
        console.log('Main Atas values:', updatedValues);
    } else if (gameMode === 'Main Bawah') {
        updatedValues = [...game.initialBidValues].map(value => value - 1);
        console.log('Main Bawah values:', updatedValues);
    }
    
    // Emit updates
    io.emit('updateBidValues', updatedValues);
    io.emit('updateGameMode', gameMode);
    
    game.phase = 'playing1-phase';
    game.currentTurn = game.bidWinner;
    io.emit('phaseChanged', game.phase);
    io.emit('updateCurrentTurn', game.currentTurn.id);
});

// Add new event handler for playing cards in playing1-phase
socket.on('playCardPlaying1', (data) => {
    console.log('playCardPlaying1 called with data:', data);
    if (game.phase !== 'playing1-phase' || game.currentTurn.id !== socket.id) return;

    const playerIndex = game.players.findIndex(player => player.id === socket.id);
    if (playerIndex === -1) return;

    const player = game.players[playerIndex];
    const cardIndex = player.hand.findIndex(card =>
        card.value === data.card.value && card.suit === data.card.suit
    );
    if (cardIndex === -1) return;

    // Validate card play before modifying any state
    if (!game.isValidCardPlay(player, data.card)) {
        socket.emit('invalidPlay', 'Cannot play truf suit card yet');
        return;
    }

    // Only proceed with card play if it's valid
    player.hand.splice(cardIndex, 1);
    io.emit('updateHands', game.getGameState().players);

    // Rest of the play logic
    const pileIds = ['bottomPile', 'rightPile', 'topPile', 'leftPile'];
    game.players.forEach((p, index) => {
        const perspectivePileId = pileIds[(index - playerIndex + 4) % 4];
        io.to(p.id).emit('cardPlayed', {
            pileIds: perspectivePileId,
            card: data.card,
            faceUp: data.card.suit === game.trufSuit ? false : true
        });
    });

    // Add card to pile with player info and face-up state
    game.pile.push({
        card: data.card,
        playerIndex,
        playerId: socket.id,
        faceUp: data.card.suit === game.trufSuit ? false : true
    });

    // If all 4 cards played, determine winner
    if (game.pile.length === 4) {
        // First flip any face-down cards
        game.pile.forEach(play => {
            if (!play.faceUp) {
                game.players.forEach((player, index) => {
                    const perspectivePileId = pileIds[(index - play.playerIndex + 4) % 4];
                    io.to(player.id).emit('cardFlipped', {
                        pileIds: perspectivePileId,
                        card: play.card,
                        faceUp: true
                    });
                });
            }
        });

        // Wait for flip animation, then handle winner and cleanup
        setTimeout(() => {
            const winningPlay = game.compareCards(game.pile);
            game.roundWinner = game.players[winningPlay.playerIndex];

            io.emit('roundWinner', {
                winnerName: game.roundWinner.name,
                winningCard: winningPlay.card
            });

            // Record and emit trick win
            const result = game.recordTrickWin(game.roundWinner.name);
            io.emit('updateTrickWins', result);

            game.discardPile.push(...game.pile);
            io.emit('updateDiscardPile', game.discardPile);

            setTimeout(() => {
                io.emit('clearPiles');
                game.pile = [];
                game.currentTurn = game.roundWinner;
                io.emit('updateCurrentTurn', game.currentTurn.id);
            }, 2000);
        }, 2000);

        return;
    }

    // Move to next player's turn
    const nextPlayerIndex = (playerIndex + 1) % game.players.length;
    game.currentTurn = game.players[nextPlayerIndex];
    io.emit('updateCurrentTurn', game.currentTurn.id);
});

socket.on('flipCard', (data) => {
    const playerIndex = game.players.findIndex(player => player.id === data.playerId);
    if (playerIndex === -1) return;

    const pileIds = ['bottomPile', 'rightPile', 'topPile', 'leftPile'];
    const playerPileIds = pileIds[playerIndex];

    game.players.forEach((player, index) => {
        const perspectivePileId = pileIds[(index - playerIndex + 4) % 4];
        io.to(player.id).emit('cardFlipped', { pileIds: perspectivePileId, card: data.card, faceUp: data.faceUp });
    });
});

socket.on('resetGame', () => {
    game.resetGame();
    io.emit('gameUpdated', game.getGameState());
});

socket.on('requestHands', () => {
    io.to(socket.id).emit('updateHands', game.getGameState().players);
});

// Update roundWinner emission to include trick wins
socket.on('roundWinner', (data) => {
    const gameState = game.recordTrickWin(data.winnerName);
    io.emit('updateScoreboard', {
        trickWins: gameState.trickWins,
        scoreboard: gameState.scoreboard
    });
});

socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    game.removePlayer(socket.id);
    io.emit('gameUpdated', game.getGameState());
    
    // Reset game if no active players
    if (!game.isActive()) {
        game = new TrufGame();
        console.log('Game reset - all players disconnected');
    }
});
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});