function calculateVictoryPoints(playerState) {
  const definitions = getCardDefinitions();

  const allCards = []
    .concat(playerState.deck || [])
    .concat(playerState.hand || [])
    .concat(playerState.discard || [])
    .concat(playerState.play || []);

  const totalCardCount =
    allCards.length;

  return allCards.reduce(function(total, cardId) {
    const card = definitions[cardId];

    if (!card) {
      return total;
    }

    if (card.dynamicVictory === 'gardens') {
      return total +
        Math.floor(totalCardCount / 10);
    }

    return total +
      Number(card.victoryPoints || 0);
  }, 0);
}

function isGameOver(roomData) {
  const supply =
    roomData.supply || {};

  if (Number(supply.province || 0) <= 0) {
    return true;
  }

  const emptyPileCount =
    Object.keys(supply).filter(function(cardId) {
      return Number(supply[cardId] || 0) <= 0;
    }).length;

  return emptyPileCount >=
    Number(roomData.emptyPileLimit || 3);
}

function createGameResult(roomData) {
  const rankings = roomData.players
    .map(function(player) {
      return {
        id:player.id,
        name:player.name,
        score:calculateVictoryPoints(player.state)
      };
    })
    .sort(function(a, b) {
      return b.score - a.score;
    });

  const topScore =
    rankings.length > 0 ? rankings[0].score : 0;

  const winners = rankings
    .filter(function(item) {
      return item.score === topScore;
    });

  return {
    finished:true,
    rankings:rankings,
    winners:winners,
    winnerIds:winners.map(function(item) {
      return item.id;
    }),
    topScore:topScore,
    roundNumber:roomData.roundNumber
  };
}
