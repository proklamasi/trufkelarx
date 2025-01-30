class TrufGame {
    constructor() {
        this.players = [];
        this.deck = [];
        this.phase = 'waiting'; // Initialize the game phase
        this.pile = []; // Initialize the pile to keep track of cards played in the current round
        this.discardPile = []; // Initialize the discard pile
        this.bidWinner = null; // Initialize the bid winner
        this.gameMode = null; // Add this to track selected game mode
        this.currentTurn = null; // Add this to track current turn
        this.trufSuit = null; // Add truf suit property
        this.roundWinner = null; // Add round winner property
        this.scoreboard = {}; // Initialize scoreboard to track wins
        this.trickWins = {}; // Add trick wins tracking
    }

    createDeck() {
        const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
        const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'j', 'q', 'k', 'a'];
        const bidValues = {
            '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
            'j': 0, 'q': 0, 'k': 0, 'a': 1
        };
        const bidRanks = {
            'j_of_clubs': 1, 'j_of_diamonds': 2, 'j_of_hearts': 3, 'j_of_spades': 4,
            'q_of_clubs': 5, 'q_of_diamonds': 6, 'q_of_hearts': 7, 'q_of_spades': 8,
            'k_of_clubs': 9, 'k_of_diamonds': 10, 'k_of_hearts': 11, 'k_of_spades': 12,
            'a_of_clubs': 13, 'a_of_diamonds': 14, 'a_of_hearts': 15, 'a_of_spades': 16,
            '2_of_clubs': 17, '2_of_diamonds': 18, '2_of_hearts': 19, '2_of_spades': 20,
            '3_of_clubs': 21, '3_of_diamonds': 22, '3_of_hearts': 23, '3_of_spades': 24,
            '4_of_clubs': 25, '4_of_diamonds': 26, '4_of_hearts': 27, '4_of_spades': 28,
            '5_of_clubs': 29, '5_of_diamonds': 30, '5_of_hearts': 31, '5_of_spades': 32,
            '6_of_clubs': 33, '6_of_diamonds': 34, '6_of_hearts': 35, '6_of_spades': 36,
            '7_of_clubs': 37, '7_of_diamonds': 38, '7_of_hearts': 39, '7_of_spades': 40,
            '8_of_clubs': 41, '8_of_diamonds': 42, '8_of_hearts': 43, '8_of_spades': 44,
            '9_of_clubs': 45, '9_of_diamonds': 46, '9_of_hearts': 47, '9_of_spades': 48,
            '10_of_clubs': 49, '10_of_diamonds': 50, '10_of_hearts': 51, '10_of_spades': 52
        };
        let deck = [];

        for (let suit of suits) {
            for (let value of values) {
                const cardKey = `${value}_of_${suit}`;
                deck.push({ suit, value, bidValue: bidValues[value], bidRank: bidRanks[cardKey] });
            }
        }

        return deck;
    }

    // Method to set the trump suit
    setTrumpSuit(suit) {
        this.trufSuit = suit;
    }

    shuffleDeck(deck) {
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
    }

    isUsernameTaken(username) {
        return this.players.some(player => player.name === username);
    }

    addPlayer(player) {
        if (this.isUsernameTaken(player.name)) {
            return false;
        }
        player.hand = [];
        this.players.push(player);
        this.scoreboard[player.name] = 0; // Track total game wins
        this.trickWins[player.name] = 0; // Track trick wins for current game
        return true;
    }

    removePlayer(playerId) {
        this.players = this.players.filter(player => player.id !== playerId);
    }

    startGame() {
        if (this.players.length !== 4) {
            console.error('Cannot start game: exactly 4 players are required');
            return;
        }
        this.deck = this.createDeck(); // Ensure the deck is created
        console.log('Deck created:', this.deck); // Debugging log
        this.shuffleDeck(this.deck); // Shuffle the deck
        console.log('Deck shuffled:', this.deck); // Debugging log
        // Deal 13 cards to each player
        const cardsPerPlayer = 13;
        this.players.forEach(player => {
            player.hand = this.deck.splice(0, cardsPerPlayer);
            this.trickWins[player.name] = 0;
        });
        console.log('Players after dealing cards:', this.players); // Debugging log
        console.log('Remaining deck:', this.deck); // Debugging log
        this.phase = 'bidding-phase'; // Set the game phase to "bidding-phase"
        console.log('Game phase:', this.phase); // Debugging log
    }

    resetGame() {
        this.deck = [];
        this.phase = 'waiting';
        this.pile = [];
        this.discardPile = [];
        this.bidWinner = null;
        this.gameMode = null;
        this.currentTurn = null;
        this.players.forEach(player => player.hand = []); // Clear each player's hand
        console.log('Game reset'); // Debugging log
    }
    
    updateWins(playerName) {
        if (this.scoreboard.hasOwnProperty(playerName)) {
            this.scoreboard[playerName]++;
        }
    }

    resetScoreboard() {
        Object.keys(this.scoreboard).forEach(playerName => {
            this.scoreboard[playerName] = 0;
        });
    }

    getGameState() {
        return {
            players: this.players.map(player => ({
                id: player.id,
                name: player.name,
                hand: player.hand
            })),
            deck: this.deck,
            phase: this.phase,
            discardPile: this.discardPile,
            bidWinner: this.bidWinner ? this.bidWinner.name : null, // Include bidWinner in the game state
            gameMode: this.gameMode,
            currentTurn: this.currentTurn ? this.currentTurn.id : null,
            trufSuit: this.trufSuit, // Include trufSuit in the game state
            trickWins: this.trickWins,
            scoreboard: this.scoreboard
        };
    }

    compareCards(cards) {
        // First card sets the leading suit
        const leadingSuit = cards[0].card.suit;
        
        // Define card values for comparison (A is highest)
        const cardValues = {
            '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
            'j': 11, 'q': 12, 'k': 13, 'a': 14
        };

        // Separate trump cards and leading suit cards
        const trufCards = cards.filter(c => c.card.suit === this.trufSuit);
        const leadingSuitCards = cards.filter(c => c.card.suit === leadingSuit);

        // If there are trump cards, highest trump wins
        if (trufCards.length > 0) {
            return trufCards.reduce((highest, current) => {
                const highestValue = cardValues[highest.card.value];
                const currentValue = cardValues[current.card.value];
                return currentValue > highestValue ? current : highest;
            }, trufCards[0]);
        }

        // If no trump cards, highest card of leading suit wins
        if (leadingSuitCards.length > 0) {
            return leadingSuitCards.reduce((highest, current) => {
                const highestValue = cardValues[highest.card.value];
                const currentValue = cardValues[current.card.value];
                return currentValue > highestValue ? current : highest;
            }, leadingSuitCards[0]);
        }

        // If no trump and no leading suit cards (shouldn't happen), take highest card
        return cards.reduce((highest, current) => {
            const highestValue = cardValues[highest.card.value];
            const currentValue = cardValues[current.card.value];
            return currentValue > highestValue ? current : highest;
        }, cards[0]);
    }

    // Method to check if a trump suit card has been played
    hasTrumpSuitBeenPlayed() {
        return this.discardPile.some(card => card.card.suit === this.trufSuit);
    }
    
        canPlayTrufCard(player) {
        // Check if any truf card has been played before
        const trufPlayed = this.hasTrumpSuitBeenPlayed();
        console.log('Trump card played:', trufPlayed);
        
        // Check if player only has truf cards left
        const onlyTrufCardsLeft = player.hand.every(card => card.suit === this.trufSuit);
        console.log('Only trump cards left:', onlyTrufCardsLeft);
        
        // Can play if any condition is true
        return trufPlayed || onlyTrufCardsLeft;
    }

    isValidCardPlay(player, card) {
        console.log('isValidCardPlay called with card:', card);
        // During playing1-phase, check truf suit restrictions for first player
        if (this.phase === 'playing1-phase' && this.pile.length === 0) {
            if (card.suit === this.trufSuit) {
                return this.canPlayTrufCard(player);
            }
        }
        return true;
    }

    // Add method to handle trick wins
    recordTrickWin(playerName) {
        if (this.trickWins.hasOwnProperty(playerName)) {
            this.trickWins[playerName]++;
            // Update game state to trigger client update
            return this.getGameState();
        }
    }

    // ...additional game logic methods...

    // Remove determineTurnWinner and notifyCurrentPlayer methods
}

module.exports = TrufGame;
