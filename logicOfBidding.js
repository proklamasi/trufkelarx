function chooseBid(cards) {
    // 1. Sort the hand by value first, then by suit
    cards.sort((a, b) => {
        const aRank = a.slice(0, -1);
        const bRank = b.slice(0, -1);

        const rankOrder = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        const aRankIndex = rankOrder.indexOf(aRank);
        const bRankIndex = rankOrder.indexOf(bRank);

        if(aRankIndex !== bRankIndex) {
            return aRankIndex - bRankIndex; //sort by value
        } else {
            const suitOrder = ['C', 'D', 'H', 'S'];
            const aSuitIndex = suitOrder.indexOf(a[a.length - 1]);
            const bSuitIndex = suitOrder.indexOf(b[b.length - 1]);
            return aSuitIndex - bSuitIndex; //if value is the same, sort by suit
        }
    });

    // 2. Return the first card (which will now be the lowest numerical card)
    return cards[0];
}

const hand = [
    "AH", "9D", "5D", "6S", "10D", "9C", "QH", "AC", "AD", "QS", "3D", "KC", "8D"
];

const bid = chooseBid(hand);
console.log(`Suggested bid card: ${bid}`);