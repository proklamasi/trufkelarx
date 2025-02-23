const socket = io();

let gamePhase = ''; // Store the current game phase
let currentTurn = null;
let firstPlayedSuit = null; // Add this line to track first played suit
let trufSuit = ''; // Add this line to store the trump suit
let discardPile = []; // Add this line to store the discard pile
let hasPlayedCard = false; // Track if player has played a card in current round
let canPlayAnyCards = false; // Flag to allow playing any cards if player does not have lead suit
let isGameStarted = false; // Flag to track if the game has started
let isBiddingDouble = false; // Track if current bid is double
let cardsPlayedInBid = 0;   // Track number of cards played in current bid
let hasBidSelected = false; // Track if player has selected a bid
let firstCardPlayed = null; // Add at top with other state variables
let currentCardCount = 0; 
let chatName = ''; // Add this line to store the chat name

socket.on('connect', () => {
    console.log('Connected to server');
    console.log('Socket ID:', socket.id); // Debugging log

    // Automatically join the lobby upon connection
    socket.emit('joinLobby');
});

socket.on('lobbyJoined', (player) => {
    console.log(`You have joined the lobby as ${player.name}`);
    document.getElementById('joinGameForm').classList.remove('active');
    document.getElementById('lobby').style.display = 'block';
});

socket.on('lobbyUpdated', (players) => {
    const lobbyElement = document.getElementById('lobbyPlayers');
    lobbyElement.innerHTML = ''; // Clear existing players
    players.forEach(player => {
        const playerElement = document.createElement('div');
        playerElement.textContent = player.name;
        lobbyElement.appendChild(playerElement);
    });
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});


// Handle chat name form submission
document.getElementById('chatNameForm').addEventListener('submit', (event) => {
    event.preventDefault();
    chatName = document.getElementById('chatName').value;
    document.getElementById('chatNameForm').style.display = 'none';
    document.getElementById('chatForm').style.display = 'flex';
});

// Chat functionality
document.getElementById('chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const message = document.getElementById('chatInput').value;
    socket.emit('chatMessage', { chatName, message });
    document.getElementById('chatInput').value = '';
});

socket.on('chatMessage', (data) => {
    const chatMessages = document.getElementById('chatMessages');
    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    messageElement.innerHTML = `<strong>${data.chatName}:</strong> ${data.message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to the bottom
});


document.getElementById('joinGameForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const username = document.getElementById('username').value;
    socket.emit('joinGame', username);
});

document.getElementById('startButton').addEventListener('click', () => {
    document.getElementById('joinGameForm').classList.add('active');
    document.getElementById('joinGameForm').style.display = 'flex'; // Ensure the form is displayed
    document.getElementById('lobby').style.display = 'none';
});

socket.on('joinGameError', (errorMessage) => {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = errorMessage;

    // Remove any existing error message
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }

    // Show the error above the form
    const form = document.getElementById('joinGameForm');
    form.insertBefore(errorDiv, form.firstChild);

    // Show the form again
    form.style.display = 'flex';

    // Clear the username input
    document.getElementById('username').value = '';
});

// Add new socket event for successful join
socket.on('joinGameSuccess', (data) => {
    document.getElementById('joinGameForm').style.display = 'none';

    // Check if there are 4 players
    if (data.players && data.players.length === 4) {
    // Game will start automatically when 4 players have joined
    socket.emit('startGame'); // Emit the 'startGame' event to the server
    }
});

socket.on('gameStarted', (gameState) => {
    console.log('Game started', gameState);
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('gameRoom').classList.add('active');
    if (gameState.players.length === 4) {
        updateGameRoom(gameState.players);
        displayDeck(gameState.deck);
        displayGamePhase(gameState.phase);
        displayPlayArea(gameState.phase);
        displayPlayerHand(gameState.players); // Ensure this is called after updating the game room
        isGameStarted = true; // Set the flag to indicate the game has started

        // Show bidding buttons if it's bidding phase
        if (gameState.phase === 'bidding-phase') {
            document.getElementById('biddingButtons').style.display = 'flex';
            updateHandClickability(); // Set all hands unclickable during bidding phase
        }
    } else {
        console.warn('Not enough players to start the game');
    }
});

socket.on('gameUpdated', (gameState) => {
    if (gameState.players.length === 4) {
        console.log('game state is updated');
        updateGameRoom(gameState.players);
        displayDeck(gameState.deck);
        displayGamePhase(gameState.phase);
        displayPlayArea(gameState.phase);
        displayPlayerHand(gameState.players); // Ensure this is called after updating the game room
        if (!isGameStarted) {
            displayPlayerHand(gameState.players); // Ensure this is called after updating the game room
        }
    } else {
        const playersNeeded = 4 - gameState.players.length; // Calculate players needed
        let message = `Waiting for ${playersNeeded} more player${playersNeeded > 1 ? 's' : ''}`; // Correct grammar
        console.log(message); // or console.warn if you want it as a warning
        // You can also display this message in the UI:
        const waitingMessageElement = document.getElementById('waitingMessage'); // Get the element where you want to display the message
        if (waitingMessageElement) {
            waitingMessageElement.textContent = message; // Set the text content
        }
    }  
});

socket.on('updateCurrentTurn', (turnPlayerId) => {
    currentTurn = turnPlayerId;
    updateHandClickability();
    // Force a redraw of the player's hand to update clickability
    socket.emit('requestHands');
});


// combinne updateHandClickability for bidding and playing1-phase
function updateHandClickability() {
    const handElement = document.getElementById('playerHand');
    const cards = handElement.querySelectorAll('.card');
    
    if (gamePhase === 'playing1-phase') {
        const isMyTurn = currentTurn === socket.id;
        handElement.classList.toggle('unclickable', !isMyTurn);
        
        cards.forEach(card => {
            const cardSuit = card.dataset.suit;
            if (isMyTurn) {
                if (cardSuit === trufSuit && !canPlayTrufSuit()) {
                    card.classList.add('disabled');
                } else {
                    card.classList.remove('disabled');
                }
            } else {
                card.classList.add('disabled');
            }
        });
    } else if (gamePhase === 'bidding-phase') {
        // First disable all cards if no bid selected
        if (!hasBidSelected || (biddingButtons && biddingButtons.style.display !== 'none')) {
            cards.forEach(card => {
                card.classList.add('disabled');
                card.style.pointerEvents = 'none';
            });
            return;
        }

        // Enable cards only after bid selection
        cards.forEach(card => {
            let isClickable = true;

            if (isBiddingDouble) {
                if (currentCardCount === 0) {
                    isClickable = true;
                } else if (currentCardCount === 1 && firstCardPlayed) {
                    const currentValue = parseInt(card.dataset.bidValue);
                    isClickable = card.dataset.suit === firstCardPlayed.suit && 
                                 (firstCardPlayed.bidValue + currentValue >= 7);
                }
            }
            
            card.classList.toggle('disabled', !isClickable);
            card.style.pointerEvents = isClickable ? 'auto' : 'none';
        });
    }
}

socket.on('updateCurrentTurn', (turnPlayerId) => {
    currentTurn = turnPlayerId;
    updateHandClickability();
    socket.emit('requestHands');
});

// Modify bid button handlers
document.getElementById('singleBid').addEventListener('click', function() {
    hasBidSelected = true;
    isBiddingDouble = false;
    cardsPlayedInBid = 0;
    updateHandClickability();
    document.querySelector('.bidding-buttons').style.display = 'none';
});

document.getElementById('doubleBids').addEventListener('click', function() {
    // Set bid state
    hasBidSelected = true;
    isBiddingDouble = true;
    cardsPlayedInBid = 0;
    firstCardPlayed = null; // Track first card

    // Update UI
    updateHandClickability();
    document.querySelector('.bidding-buttons').style.display = 'none';

    // Emit bid selection
    socket.emit('placeBid', { type: 'doubleBids' });
});

document.getElementById('noTrumps').addEventListener('click', function() {
    hasBidSelected = true;
    isBiddingDouble = true;
    cardsPlayedInBid = 0;
    updateHandClickability();
    document.querySelector('.bidding-buttons').style.display = 'none';
});


function canPlayTrufSuit() {
    console.log('canPlayTrufSuit called');

    // Check if discardPile is empty (first round)
    if (!discardPile || discardPile.length === 0) {
        console.log('First round - only allow truf if no other cards');
        return Array.from(document.querySelectorAll('#playerHand .card'))
            .every(card => card.dataset.suit === trufSuit);
    }

    // Check for truf already played
    const trufPlayed = discardPile.some(card => card.card.suit === trufSuit);
    console.log('Trump played:', trufPlayed, 'Current truf:', trufSuit);

    // Check player's hand
    const onlyTrufCardsLeft = Array.from(document.querySelectorAll('#playerHand .card'))
        .every(card => card.dataset.suit === trufSuit);
    console.log('Only truf cards left:', onlyTrufCardsLeft);

    // Check last set for different suits
    const lastFourCards = discardPile.slice(-Math.min(4, discardPile.length));
    const hasDifferentSuit = lastFourCards.length >= 2 && 
        lastFourCards.some(card => card.card.suit !== lastFourCards[0].card.suit);
    console.log('Different suits check:', {
        cardsChecked: lastFourCards.map(c => `${c.card.value} of ${c.card.suit}`),
        hasDifferentSuit
    });

    const canPlayTruf = trufPlayed || onlyTrufCardsLeft || hasDifferentSuit;
    console.log('Can play truf:', canPlayTruf);
    return canPlayTruf;
}

socket.on('cardPlayed', (data) => {
    const pileElement = document.getElementById(data.pileIds);
    if (!pileElement) return;

    pileElement.innerHTML = ''; // Clear any existing card
    const pileCardElement = document.createElement('img');
    pileCardElement.className = 'card';
    pileCardElement.src = data.faceUp ? 
        `images/${data.card.value}_of_${data.card.suit}.svg` : 
        `images/back.svg`; // Face-up or face-down
    pileCardElement.dataset.value = data.card.value;
    pileCardElement.dataset.suit = data.card.suit;
    pileCardElement.dataset.faceUp = data.faceUp ? 'true' : 'false';
    pileElement.appendChild(pileCardElement);

    // Set first played suit when first card is played in playing1-phase
    if (gamePhase === 'playing1-phase' && document.querySelectorAll('.pile .card').length === 1) {
        firstPlayedSuit = data.card.suit; // Set first played suit when first card is played
    }
});

socket.on('cardFlipped', (data) => {
    const pileElement = document.getElementById(data.pileIds);
    const pileCardElement = pileElement.querySelector('.card');
    if (data.faceUp) {
        pileCardElement.src = `images/${data.card.value}_of_${data.card.suit}.svg`; // Flip to face-up
        pileCardElement.dataset.faceUp = 'true';
    } else {
        pileCardElement.src = `images/back.svg`; // Flip to face-down
        pileCardElement.dataset.faceUp = 'false';
    }
});

socket.on('updateHands', (players) => {
    console.log(players.length);
    displayPlayerHand(players); // Ensure this is called with the full list of players
    updateHandClickability(); // Update hand clickability when hands are updated
});

socket.on('clearPiles', () => {
    const pileIds = ['bottomPile', 'leftPile', 'topPile', 'rightPile', 'bottomExtraPile', 'leftExtraPile', 'topExtraPile', 'rightExtraPile'];
    pileIds.forEach(pileIds => {
        const pileElement = document.getElementById(pileIds);
        pileElement.innerHTML = ''; // Clear the pile
    });
    hasPlayedCard = false; // Reset the flag when piles are cleared
});

socket.on('phaseChanged', (phase) => {
    hasBidSelected = false; // Reset bid selection flag when phase changes
    displayGamePhase(phase);
    displayPlayArea(phase);
    if (phase === 'playing1-phase') {
        firstPlayedSuit = null; // Reset first played suit when phase changes
        updateHandClickability(); // Update clickability when phase changes
    }
    
    // Hide bidding buttons when not in bidding phase
    if (phase !== 'bidding-phase') {
        document.getElementById('biddingButtons').style.display = 'none';
    }
    
    // Hide extra piles when not in bidding phase
    if (phase !== 'bidding-phase') {
        document.querySelectorAll('.pile-extra').forEach(pile => {
            pile.style.display = 'none';
        });
    }
});

socket.on('updateDiscardPile', (newDiscardPile) => {
    console.log('Discard pile updated:', discardPile.length);
    discardPile = newDiscardPile; // Store the complete discard pile data
    console.log('Updated discard pile:', discardPile);
    isDiscardUpdated = true;
    
    const discardPileElement = document.getElementById('discardPile');
    if (!discardPileElement) {
        console.error('Discard pile element not found');
        return;
    }
    discardPileElement.innerHTML = '';
    discardPile.forEach(card => {
        const discardCardElement = document.createElement('img');
        discardCardElement.className = 'card';
        discardCardElement.src = `images/${card.card.value}_of_${card.card.suit}.svg`;
        discardPileElement.appendChild(discardCardElement);
    });
    updateHandClickability();
});

socket.on('updateTrufSuit', (trufSuit) => {
    trufSuit = trufSuit;
    document.getElementById('trufSuit').textContent = trufSuit;
    updateHandClickability();
});

socket.on('updatePlayerNamesAndBidValues', ({ playerNames, bidValues }) => {
    const playerNameColumn = document.querySelector('.player-col');
    const bidValueColumn = document.querySelector('.bid-col');

    playerNameColumn.innerHTML = playerNames.join('<br>');
    bidValueColumn.innerHTML = bidValues.join('<br>');
});

socket.on('updateGameMode', (gameMode) => {
    document.getElementById('gameMode').textContent = gameMode;
});

socket.on('updateBidWinner', (bidWinner) => {
    document.getElementById('bidWinner').textContent = bidWinner;
});

socket.on('updateBidValues', (updatedBidValues) => {
    const bidValueColumn = document.querySelector('.bid-col');
    bidValueColumn.innerHTML = updatedBidValues.join('<br>');
});

socket.on('showChooseGameModeButtons', () => {
    const bidWinner = document.getElementById('bidWinner').textContent;
    const currentPlayer = socket.id;
    const currentPlayerName = document.querySelector(`#bottomChair`).textContent; // Assuming the current player is at the bottom chair
    if (bidWinner === currentPlayerName) {
        document.getElementById('chooseGameModeButtons').style.display = 'flex';
    }
});

    document.getElementById('mainAtasButton').addEventListener('click', () => {
        socket.emit('chooseGameMode', { gameMode: 'Main Atas' });
        document.getElementById('chooseGameModeButtons').style.display = 'none';
    });

    document.getElementById('mainBawahButton').addEventListener('click', () => {
        socket.emit('chooseGameMode', { gameMode: 'Main Bawah' });
        document.getElementById('chooseGameModeButtons').style.display = 'none';
    });

    document.getElementById('mainAtasButton').addEventListener('click', () => {
        socket.emit('chooseGameMode', { gameMode: 'Main Atas' });
        document.getElementById('chooseGameModeButtons').style.display = 'none';
    });

    document.getElementById('mainBawahButton').addEventListener('click', () => {
        socket.emit('chooseGameMode', { gameMode: 'Main Bawah' });
        document.getElementById('chooseGameModeButtons').style.display = 'none';
    });

socket.on('roundWinner', (data) => {
    // Create temporary message element
    const messageDiv = document.createElement('div');
    messageDiv.className = 'winner-message';
    messageDiv.textContent = `kartu tertinggi: ${data.winningCard.value} ${data.winningCard.suit}!, milik ${data.winnerName}`;
    document.getElementById('gameRoom').appendChild(messageDiv);
    
    // Remove message after a delay
    setTimeout(() => {
        messageDiv.remove();
    }, 2000);
});

socket.on('updateTrickWins', (data) => {
    const bidValues = document.getElementById('bidValues');
    if (!bidValues) return;

    // Get the trick wins column
    const trickWinsColumn = document.querySelector('.trick-wins');
    if (!trickWinsColumn) return;

    // Create an array of wins and join them with line breaks
    const winsArray = Object.values(data.trickWins);
    trickWinsColumn.innerHTML = winsArray.join('<br>');
    console.log('Updated trick wins:', winsArray); // Debug log
});


// Add listener for invalid play messages
socket.on('invalidPlay', (message) => {
    // Create temporary error message element
    const messageDiv = document.createElement('div');
    messageDiv.className = 'error-message';
    messageDiv.textContent = message;
    document.getElementById('gameRoom').appendChild(messageDiv);

    // Remove message after a delay
    setTimeout(() => {
        messageDiv.remove();
    }, 2000);
});

function updateGameRoom(players) {
    console.log('Updating game room with players:', players); // Debugging log
    const chairIds = ['bottomChair', 'leftChair', 'topChair', 'rightChair'];
    const currentPlayerIndex = players.findIndex(player => player.id === socket.id);
    console.log('Current player index:', currentPlayerIndex); // Debugging log
    if (currentPlayerIndex === -1) {
        console.error('Current player not found in players array'); // Debugging log
        return;
    }
    const orderedPlayers = [
        players[currentPlayerIndex],
        players[(currentPlayerIndex + 1) % players.length],
        players[(currentPlayerIndex + 2) % players.length],
        players[(currentPlayerIndex + 3) % players.length]
    ];
    console.log('Ordered players:', orderedPlayers); // Debugging log

    orderedPlayers.forEach((player, index) => {
        const chair = document.getElementById(chairIds[index]);
        if (player) {
            chair.textContent = player.name;
        } else {
            chair.textContent = ''; // Clear the chair if no player
        }
    });
}

function displayDeck(deck) {
    const deckElement = document.getElementById('deck');
    deckElement.innerHTML = ''; // Clear any existing cards
    console.log('Displaying deck:', deck); // Debugging log
    deck.forEach(card => {
        const cardElement = document.createElement('img');
        cardElement.className = 'card';
        cardElement.src = `images/back.svg`; // Use the back of the card image
        deckElement.appendChild(cardElement);
    });
    console.log('Deck element:', deckElement); // Debugging log
}

function mustFollowSuit(card, hand) {
    if (!firstPlayedSuit || card.suit === firstPlayedSuit) {
        return true;
    }
    // Check if player has any cards of the required suit
    const hasLeadSuit = hand.some(c => c.suit === firstPlayedSuit);
    if (!hasLeadSuit) {
        canPlayAnyCards = true; // Set the flag if the player does not have the lead suit
        console.log(`canPlayAnyCards flag set to true because player does not have ${firstPlayedSuit}`);
    }
    return !hasLeadSuit;
}

function isCardPlayable(card, hand) {
    if (gamePhase === 'playing1-phase') {
        // First player restrictions for truf suit
        if (document.querySelectorAll('.pile .card').length === 0) {
            if (card.suit === trufSuit) {
                return canPlayTrufSuit();
            }
            return true; // Non-truf cards can always be played as first card
        } 
        // Subsequent players must follow suit
        else {
            return mustFollowSuit(card, hand);
        }
    }
    return true;
}

function displayPlayerHand(players) {
    const currentPlayer = players.find(player => player.id === socket.id);
    if (!currentPlayer) {
        console.error('Current player not found');
        return;
    }
    const handElement = document.getElementById('playerHand');
    handElement.innerHTML = '';
    
    currentPlayer.hand.forEach((card, index) => {
        const cardElement = document.createElement('img');
        cardElement.className = 'card';
        cardElement.src = `images/${card.value}_of_${card.suit}.svg`;
        cardElement.dataset.index = index;
        cardElement.dataset.suit = card.suit;

        const isMyTurn = gamePhase === 'bidding-phase' || 
                        (gamePhase === 'playing1-phase' && currentTurn === socket.id);

        const isPlayable = isMyTurn && isCardPlayable(card, currentPlayer.hand);

        if (isPlayable) {
            cardElement.classList.remove('disabled');
            cardElement.style.cursor = 'pointer';
            cardElement.addEventListener('click', () => {
                if (gamePhase === 'bidding-phase') {
                    playCard(cardElement, currentPlayer.hand);
                } else if (gamePhase === 'playing1-phase') {
                    playCardPlaying1(cardElement, currentPlayer.hand);
                }
            });
        } else {
            cardElement.classList.add('disabled');
            cardElement.style.cursor = 'not-allowed';
        }

        handElement.appendChild(cardElement);
    });

    updateHandClickability();
}

function displayGamePhase(phase) {
    const phaseElement = document.getElementById('gamePhase');
    const phaseNames = {
        'waiting': 'Waiting for Players',
        'bidding-phase': 'Bidding Phase',
        'playing1-phase': 'First Playing Phase',
        'playing2-phase': 'Second Playing Phase',
        'playing3-phase': 'Third Playing Phase'
    };
    
    const displayName = phaseNames[phase] || phase;
    phaseElement.textContent = `Phase: ${displayName}`;
    gamePhase = phase; // Store the actual phase name
    console.log('Game phase element:', phaseElement);
}

function displayPlayArea(phase) {
    const playAreaElement = document.getElementById('playArea');
    playAreaElement.style.display = 'block'; // Always display the play area
    console.log('Play area element:', playAreaElement); // Debugging log
}

function playCard(cardElement, hand) {
    if (gamePhase !== 'bidding-phase') return;

    const cardIndex = parseInt(cardElement.dataset.index, 10);
    if (isNaN(cardIndex) || cardIndex < 0 || cardIndex >= hand.length) {
        console.error('Invalid card index');
        return;
    }

    const card = hand[cardIndex];

    // Check if player can play more cards
    if (!isBiddingDouble && cardsPlayedInBid >= 1) return;
    if (isBiddingDouble && cardsPlayedInBid >= 2) return;

    // For double bids, validate second card
    if (isBiddingDouble && cardsPlayedInBid === 1) {
        if (card.suit !== firstCardPlayed.suit || 
            card.bidValue + firstCardPlayed.bidValue < 7) {
            console.error('Invalid second card for double bid');
            return;
        }
    }

    // Track first card for double bids
    if (isBiddingDouble && cardsPlayedInBid === 0) {
        firstCardPlayed = {
            suit: card.suit,
            bidValue: card.bidValue
        };
    }

    // Rest of your existing code...
    let pileIds;
    let isExtraPile = false;
    
    if (isBiddingDouble && cardsPlayedInBid === 1) {
        pileIds = 'bottomExtraPile';
        isExtraPile = true;
    } else {
        pileIds = 'bottomPile';
    }

    // ...existing pile element creation and card placement...
    const pileElement = document.getElementById(pileIds);
    if (pileElement.children.length > 0) return;
    
    pileElement.innerHTML = '';
    const pileCardElement = document.createElement('img');
    pileCardElement.className = 'card';
    pileCardElement.src = 'images/back.svg';
    pileCardElement.dataset.value = card.value;
    pileCardElement.dataset.suit = card.suit;
    pileCardElement.dataset.faceUp = 'false';
    pileElement.appendChild(pileCardElement);

    hand.splice(cardIndex, 1); // play bidding card
    displayPlayerHand([{ id: socket.id, hand }]); // update a bidding hand

    
    socket.emit('playCard', {
        playerId: socket.id,
        pileIds,
        card,
        isExtraPile,
        isSecondCard: cardsPlayedInBid === 1
    });

    cardsPlayedInBid++;
    updateHandClickability();
}

function playCardPlaying1(cardElement, hand) {
    if (gamePhase !== 'playing1-phase' || 
        currentTurn !== socket.id || 
        hasPlayedCard) return;

    const cardIndex = parseInt(cardElement.dataset.index, 10);
    if (isNaN(cardIndex) || cardIndex < 0 || cardIndex >= hand.length) return;

    const card = hand[cardIndex];
    
    // Validate before doing anything with the card
    if (!isCardPlayable(card, hand)) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'error-message';
        messageDiv.textContent = 'Belum bisa memainkan kartu truf!';
        document.getElementById('gameRoom').appendChild(messageDiv);
        setTimeout(() => messageDiv.remove(), 2000);
        return;
    }

    // Only proceed if card is playable
    socket.emit('playCardPlaying1', { 
        playerId: socket.id, 
        pileIds: 'bottomPile', 
        card 
    });
}

function flipCard(cardElement) {
    const pileIds = cardElement.parentElement.id;
    const isFaceUp = cardElement.dataset.faceUp === 'true';
    const card = {
        value: cardElement.dataset.value,
        suit: cardElement.dataset.suit
    };
    if (isFaceUp) {
        cardElement.src = `images/back.svg`; // Flip to face-down
        cardElement.dataset.faceUp = 'false';
        socket.emit('flipCard', { playerId: socket.id, pileIds, card, faceUp: false }); // Emit the flipCard event to the server
    } else {
        cardElement.src = `images/${card.value}_of_${card.suit}.svg`; // Flip to face-up
        cardElement.dataset.faceUp = 'true';
        socket.emit('flipCard', { playerId: socket.id, pileIds, card, faceUp: true }); // Emit the flipCard event to the server
    }
}

// Update socket listener for scoreboard updates
socket.on('updateScoreboard', (scoreData) => {
    updateScoreboard(scoreData);
});

// Make sure to call updateScoreboard whenever game state updates
socket.on('gameState', (gameState) => {
    // ...existing gameState handling...
    if (gameState.scoreboard) {
        updateScoreboard(gameState.scoreboard);
    }
});

// Also update when a new player joins
socket.on('playerJoined', (gameState) => {
    if (gameState.scoreboard) {
        updateScoreboard(gameState.scoreboard);
    }
});

// Add click handlers for bidding buttons
document.querySelectorAll('#biddingButtons button').forEach(button => {
    button.addEventListener('click', () => {
        const bidType = button.id;
        socket.emit('placeBid', { type: bidType });
        document.getElementById('biddingButtons').style.display = 'none';
        
        // Set bidding type flag
        isBiddingDouble = (bidType === 'doubleBids' || bidType === 'noTrumps');
        isDoubleBids = bidType === 'doubleBids';
        isNoTrumps = bidType === 'noTrumps';
        cardsPlayedInBid = 0; // Reset cards played counter
        
        // Show extra piles for double bids
        if (isBiddingDouble) {
            document.querySelectorAll('.pile-extra').forEach(pile => {
                pile.style.display = 'block';
            });
            updateHandClickability(true); // Make hand clickable for double bids
        }

        // Make hand clickable if single bid
        if (bidType === 'singleBid') {
            updateHandClickability(true);
        }
    });
});

// Add new handler for returning bid cards
socket.on('returnBidCards', (data) => {
    // Clear all piles first
    const allPileIds = ['bottomPile', 'leftPile', 'topPile', 'rightPile',
                       'bottomExtraPile', 'leftExtraPile', 'topExtraPile', 'rightExtraPile'];
    allPileIds.forEach(pileIds => {
        const pileElement = document.getElementById(pileIds);
        if (pileElement) pileElement.innerHTML = '';
    });

    // Reset bid counters
    cardsPlayedInBid = 0;
    isBiddingDouble = false;

    // Hide extra piles
    document.querySelectorAll('.pile-extra').forEach(pile => {
        pile.style.display = 'none';
    });

    // Update player's hand with returned cards
    if (data.hand) {
        displayPlayerHand([{ id: socket.id, hand: data.hand }]);
    }
});


// Listen for an event that indicates the end of the round or game
socket.on('endOfRound', ({ bidValues, winValues, gameMode, resultValues }) => {
    const resultValueColumn = document.querySelector('.final-result');
    // Display the calculated final results
    resultValueColumn.innerHTML = resultValues.join('<br>');
    console.log(resultValueColumn);
});
// ...additional client-side code.