const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const TrufGame = require('./game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

const game = new TrufGame();

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

    socket.on('playCard', (data) => {
        const playerIndex = game.players.findIndex(player => player.id === data.playerId);
        if (playerIndex === -1) return; // Ensure the player exists

        // Only allow card play during bidding phase
        if (game.phase !== 'bidding-phase') return;

        const player = game.players[playerIndex];
        const cardIndex = player.hand.findIndex(card => card.value === data.card.value && card.suit === data.card.suit);
        if (cardIndex === -1) return; // Card not found in player's hand

        player.hand.splice(cardIndex, 1); // Remove the card from the player's hand

        // Get all player names first
        const allPlayerNames = game.players.map(p => p.name);

        const pileIds = ['bottomPile', 'rightPile', 'topPile', 'leftPile'];
        game.players.forEach((player, index) => {
            const perspectivePileId = pileIds[(index - playerIndex + 4) % 4];
            io.to(player.id).emit('cardPlayed', { pileId: perspectivePileId, card: data.card, faceUp: false });
        });

        // Check if it's the fourth card played in the current round
        game.pile.push({ card: data.card, playerIndex, originalIndex: cardIndex });
        if (game.pile.length === 4) {
            setTimeout(() => {
                game.pile.forEach(({ card, playerIndex }) => {
                    game.players.forEach((player, index) => {
                        const perspectivePileId = pileIds[(index - playerIndex + 4) % 4];
                        io.to(player.id).emit('cardFlipped', { pileId: perspectivePileId, card, faceUp: true });
                    });
                });

                setTimeout(() => {
                    // Determine the truf suit based on the highest bidRank card
                    const highestBidRankCard = game.pile.reduce((highest, current) => {
                        return current.card.bidRank > highest.card.bidRank ? current : highest;
                    });
                    const trufSuit = highestBidRankCard.card.suit;
                    game.setTrumpSuit(trufSuit);
                    io.emit('updateTrufSuit', trufSuit);

                    // Get player names and bid values
                    const playerNames = game.pile.map(({ playerIndex }) => game.players[playerIndex].name);
                    const bidValues = game.pile.map(({ card }) => card.bidValue);
                    game.initialBidValues = [...bidValues];

                    // Get bid values in correct player order
                    const orderedBidValues = allPlayerNames.map(name => {
                        const play = game.pile.find(p => game.players[p.playerIndex].name === name);
                        return play ? play.card.bidValue : 0;
                    });

                    // Emit player names and bid values in consistent order
                    io.emit('updatePlayerNamesAndBidValues', {
                        playerNames: allPlayerNames,
                        bidValues: orderedBidValues
                    });

                    // Determine the game mode based on the sum of bid values
                    const bidValueSum = bidValues.reduce((sum, value) => sum + value, 0);
                    if (bidValueSum === 13) {
                        const bidWinner = game.players[highestBidRankCard.playerIndex];
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

                    game.pile.forEach(({ card, playerIndex, originalIndex }) => {
                        game.players[playerIndex].hand.splice(originalIndex, 0, card);
                    });
                    io.emit('updateHands', game.getGameState().players);

                    io.emit('clearPiles');
                    game.pile = [];
                }, 3000);
            }, 2000);
        }
    });

    socket.on('chooseGameMode', (data) => {
        const gameMode = data.gameMode;
        game.gameMode = gameMode; // Store the selected game mode
        if (gameMode === 'Main Atas') {
            game.initialBidValues = game.initialBidValues.map(value => value + 1);
        } else if (gameMode === 'Main Bawah') {
            game.initialBidValues = game.initialBidValues.map(value => value - 1);
        }
        io.emit('updateBidValues', game.initialBidValues);
        io.emit('updateGameMode', gameMode);

        // Set current turn to bid winner when transitioning to playing1-phase
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
                pileId: perspectivePileId, 
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
                            pileId: perspectivePileId, 
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
        const playerPileId = pileIds[playerIndex];

        game.players.forEach((player, index) => {
            const perspectivePileId = pileIds[(index - playerIndex + 4) % 4];
            io.to(player.id).emit('cardFlipped', { pileId: perspectivePileId, card: data.card, faceUp: data.faceUp });
        });
    });

    socket.on('resetGame', () => {
        game.resetGame();
        io.emit('gameUpdated', game.getGameState());
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        game.removePlayer(socket.id);
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

    // ...additional socket event handlers...
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
