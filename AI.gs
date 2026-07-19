function isAiControlledPlayer_(player) {
  return Boolean(
    player &&
    (
      player.isAi ||
      player.aiControlled
    )
  );
}

function isAiStepNeeded_(roomData) {
  if (
    !roomData ||
    roomData.status !== '遊戲中'
  ) {
    return false;
  }

  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    const player =
      findPlayer_(
        roomData,
        interaction.playerId
      );

    return Boolean(
      player &&
      isAiControlledPlayer_(player)
    );
  }

  if (roomData.phase === 'action') {
    const active =
      roomData.players[
        Number(roomData.actionIndex || 0)
      ];

    return Boolean(
      active &&
      isAiControlledPlayer_(active) &&
      !active.actionFinished
    );
  }

  if (roomData.phase === 'buy') {
    return roomData.players.some(function(player) {
      return (
        isAiControlledPlayer_(player) &&
        !player.buyFinished
      );
    });
  }

  return false;
}

function processAiStep(roomNumber) {
  roomNumber =
    cleanRoomNumber(roomNumber);

  if (!roomNumber) {
    throw new Error('AI 找不到房號。');
  }

  const cache =
    CacheService.getScriptCache();

  const leaseKey =
    'AI_LEASE_' + roomNumber;

  const leaseToken =
    Utilities.getUuid();

  cache.put(
    leaseKey,
    leaseToken,
    8
  );

  if (
    cache.get(leaseKey) !==
    leaseToken
  ) {
    return {
      success:true,
      processed:false,
      skipped:true
    };
  }

  try {
    return withRoomLock_(function() {
      const context =
        loadRoomContext_(roomNumber);

      const roomData =
        context.roomData;

      if (!isAiStepNeeded_(roomData)) {
        return {
          success:true,
          processed:false
        };
      }

      try {
        const interaction =
          getCurrentInteraction_(roomData);

        if (interaction) {
          processAiInteraction_(
            roomData,
            interaction
          );
        } else if (
          roomData.phase === 'action'
        ) {
          processAiAction_(roomData);
        } else if (
          roomData.phase === 'buy'
        ) {
          processAiPurchase_(roomData);
        }

        resetCurrentTimer_(roomData);
        saveRoomContext_(context);

        return {
          success:true,
          processed:true
        };
      } catch (error) {
        /*
         * AI 單一步驟失敗時，不讓整場永遠卡在同一個互動。
         * 記錄錯誤並採用安全退路。
         */
        recoverAiStep_(
          roomData,
          error
        );

        resetCurrentTimer_(roomData);
        saveRoomContext_(context);

        return {
          success:true,
          processed:true,
          recovered:true,
          message:String(
            error && error.message
              ? error.message
              : error
          )
        };
      }
    });
  } finally {
    if (
      cache.get(leaseKey) ===
      leaseToken
    ) {
      cache.remove(leaseKey);
    }
  }
}

function recoverAiStep_(
  roomData,
  error
) {
  const message =
    String(
      error && error.message
        ? error.message
        : error
    );

  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    const player =
      findPlayer_(
        roomData,
        interaction.playerId
      );

    addLog_(
      roomData,
      player ? player.name : 'AI',
      'AI 效果採用安全處理：' +
        message
    );

    completeCurrentInteraction_(roomData);
    return;
  }

  if (roomData.phase === 'action') {
    const player =
      roomData.players[
        Number(roomData.actionIndex || 0)
      ];

    if (player && isAiControlledPlayer_(player)) {
      player.actionFinished = true;

      addLog_(
        roomData,
        player.name,
        'AI 略過異常行動並完成行動階段'
      );

      advanceActionIndex_(roomData);
    }

    return;
  }

  if (roomData.phase === 'buy') {
    const player =
      roomData.players.find(function(item) {
        return (
          isAiControlledPlayer_(item) &&
          !item.buyFinished
        );
      });

    if (player) {
      player.buyFinished = true;

      addLog_(
        roomData,
        player.name,
        'AI 略過異常購買並完成購買'
      );

      finishRoundIfReady_(roomData);
    }
  }
}

function processAiInteraction_(
  roomData,
  interaction
) {
  const player =
    findPlayer_(
      roomData,
      interaction.playerId
    );

  if (
    !player ||
    !isAiControlledPlayer_(player) ||
    !player.state
  ) {
    completeCurrentInteraction_(roomData);
    return;
  }

  if (interaction.type === 'reaction') {
    processAiReaction_(
      roomData,
      player,
      interaction
    );
    return;
  }


  if (
    interaction.type === 'libraryDecision'
  ) {
    const cardId =
      interaction.revealedCardId;

    const card =
      getCardDefinition(cardId);

    const shouldKeep =
      Boolean(
        card &&
        (
          Number(card.actions || 0) > 0 ||
          cardId === 'market' ||
          cardId === 'laboratory'
        )
      );

    resolveLibraryDecision_(
      roomData,
      player,
      interaction,
      {
        action:
          shouldKeep
            ? 'keep'
            : 'setaside'
      }
    );

    finalizeInteraction_(
      roomData,
      interaction,
      'ai-choice'
    );

    continueAttackAfterInteraction_(
      roomData,
      interaction,
      'ai-choice'
    );

    return;
  }

  if (
    interaction.type === 'thiefTrashDecision'
  ) {
    const options =
      (
        interaction.treasureOptions ||
        []
      ).slice();

    options.sort(function(left, right) {
      const leftCard =
        getCardDefinition(left);

      const rightCard =
        getCardDefinition(right);

      return (
        Number(
          rightCard
            ? rightCard.cost
            : 0
        ) -
        Number(
          leftCard
            ? leftCard.cost
            : 0
        )
      );
    });

    resolveThiefTrashDecision_(
      roomData,
      player,
      interaction,
      {
        cardId:options[0]
      }
    );

    finalizeInteraction_(
      roomData,
      interaction,
      'ai-choice'
    );

    continueAttackAfterInteraction_(
      roomData,
      interaction,
      'ai-choice'
    );

    return;
  }

  if (
    interaction.type === 'thiefGainDecision'
  ) {
    resolveThiefGainDecision_(
      roomData,
      player,
      interaction,
      {action:'gain'}
    );

    finalizeInteraction_(
      roomData,
      interaction,
      'ai-choice'
    );

    return;
  }

  if (interaction.type === 'spyDecision') {
    processAiSpyDecision_(
      roomData,
      player,
      interaction
    );

    completeCurrentInteraction_(roomData);
    return;
  }

  if (interaction.type === 'thiefDecision') {
    processAiThiefDecision_(
      roomData,
      player,
      interaction
    );

    completeCurrentInteraction_(roomData);
    return;
  }

  if (interaction.type === 'discard') {
    const required =
      Math.max(
        0,
        Number(
          interaction.requiredDiscardCount || 0
        )
      );

    const indexes =
      chooseAiDiscardIndexes_(
        player,
        required
      );

    removeHandCards_(
      player.state,
      indexes,
      'discard'
    );

    addLog_(
      roomData,
      player.name,
      '因攻擊棄掉 ' +
        indexes.length +
        ' 張牌'
    );

    completeCurrentInteraction_(roomData);
    return;
  }

  if (
    interaction.type === 'selectSupply'
  ) {
    const cardId =
      chooseAiSupplyCard_(
        roomData,
        player,
        interaction
      );

    if (cardId) {
      resolveSupplySelection_(
        roomData,
        player,
        interaction,
        {cardId:cardId}
      );
    } else {
      addLog_(
        roomData,
        player.name,
        '沒有符合條件的供應區卡片，AI 放棄此效果'
      );
    }

    completeCurrentInteraction_(roomData);
    return;
  }

  if (
    interaction.type === 'selectHand'
  ) {
    const indexes =
      chooseAiHandIndexes_(
        player,
        interaction
      );

    const minimum =
      Math.max(
        0,
        Number(interaction.min || 0)
      );

    if (
      indexes.length < minimum
    ) {
      const fallback =
        chooseRequiredHandIndexes_(
          player,
          interaction,
          minimum
        );

      if (fallback.length < minimum) {
        addLog_(
          roomData,
          player.name,
          '沒有符合條件的手牌，AI 放棄此效果'
        );

        completeCurrentInteraction_(roomData);
        return;
      }

      resolveHandSelection_(
        roomData,
        player,
        interaction,
        {handIndexes:fallback}
      );
    } else {
      resolveHandSelection_(
        roomData,
        player,
        interaction,
        {handIndexes:indexes}
      );
    }

    completeCurrentInteraction_(roomData);
    return;
  }

  addLog_(
    roomData,
    player.name,
    '略過未知 AI 互動：' +
      String(interaction.type || '')
  );

  completeCurrentInteraction_(roomData);
}


function processAiSpyDecision_(
  roomData,
  actor,
  interaction
) {
  const target =
    findPlayer_(
      roomData,
      interaction.targetPlayerId
    );

  if (!target || !target.state) {
    return;
  }

  const cardId =
    interaction.revealedCardId;

  const card =
    getCardDefinition(cardId);

  const value =
    getAiRevealedCardValue_(cardId);

  const shouldDiscard =
    interaction.targetIsActor
      ? value <= 12
      : value >= 20;

  if (shouldDiscard) {
    target.state.discard.push(cardId);
  } else {
    target.state.deck.unshift(cardId);
  }

  addLog_(
    roomData,
    actor.name,
    '透過「間諜」將' +
      (
        interaction.targetIsActor
          ? '自己的'
          : target.name + '的'
      ) +
      '「' +
      (card ? card.name : cardId) +
      '」' +
      (
        shouldDiscard
          ? '棄掉'
          : '保留在牌庫頂'
      )
  );
}

function processAiThiefDecision_(
  roomData,
  actor,
  interaction
) {
  const target =
    findPlayer_(
      roomData,
      interaction.targetPlayerId
    );

  if (!target || !target.state) {
    return;
  }

  const revealed =
    Array.isArray(
      interaction.revealedCardIds
    )
      ? interaction.revealedCardIds.slice()
      : [];

  const options =
    Array.isArray(
      interaction.treasureOptions
    )
      ? interaction.treasureOptions.slice()
      : [];

  options.sort(function(leftId, rightId) {
    return (
      getAiRevealedCardValue_(rightId) -
      getAiRevealedCardValue_(leftId)
    );
  });

  const selected =
    options.length
      ? options[0]
      : '';

  let stolenUsed = false;

  revealed.forEach(function(cardId) {
    if (
      selected &&
      !stolenUsed &&
      cardId === selected
    ) {
      actor.state.discard.push(cardId);
      stolenUsed = true;
    } else {
      target.state.discard.push(cardId);
    }
  });

  if (selected) {
    const card =
      getCardDefinition(selected);

    addLog_(
      roomData,
      actor.name,
      '從' +
        target.name +
        '偷走「' +
        (card ? card.name : selected) +
        '」'
    );
  }
}

function getAiRevealedCardValue_(cardId) {
  const card =
    getCardDefinition(cardId);

  if (!card) return 0;

  let value =
    Number(card.cost || 0) * 5;

  if (hasCardType_(card, 'treasure')) {
    value +=
      Number(card.coin || 0) * 12;
  }

  if (hasCardType_(card, 'action')) {
    value += 18;
  }

  if (hasCardType_(card, 'victory')) {
    value +=
      Number(card.victoryPoints || 0) * 5;
  }

  if (cardId === 'curse') {
    value = -30;
  }

  if (cardId === 'estate') {
    value = 2;
  }

  if (cardId === 'copper') {
    value = 8;
  }

  return value;
}

function processAiReaction_(
  roomData,
  player,
  interaction
) {
  const shouldReveal =
    Boolean(
      player &&
      player.state &&
      player.state.hand &&
      player.state.hand
        .indexOf('moat') !== -1
    );

  resolveAttackReaction_(
    roomData,
    interaction,
    shouldReveal
  );

  runEffectEngine_(
    roomData,
    shouldReveal
      ? 'ai-moat-revealed'
      : 'ai-moat-declined'
  );
}

function processAiAction_(roomData) {
  const playerIndex =
    Number(
      roomData.actionIndex || 0
    );

  const player =
    roomData.players[playerIndex];

  if (
    !player ||
    !isAiControlledPlayer_(player) ||
    !player.state
  ) {
    return;
  }

  if (
    Number(player.state.actions || 0) <= 0
  ) {
    finishAiAction_(roomData, player);
    return;
  }

  const actionChoice =
    chooseAiActionChoice_(
      roomData,
      player
    );

  const handIndex =
    actionChoice
      ? actionChoice.index
      : -1;

  if (handIndex === -1) {
    finishAiAction_(roomData, player);
    return;
  }

  const cardId =
    player.state.hand[handIndex];

  const card =
    getCardDefinition(cardId);

  if (
    !card ||
    !hasCardType_(card, 'action')
  ) {
    finishAiAction_(roomData, player);
    return;
  }

  player.state.actions -= 1;
  player.state.hand.splice(
    handIndex,
    1
  );
  player.state.play.push(cardId);

  const result =
    applyCardEffects_(
      roomData,
      playerIndex,
      card
    );

  if (actionChoice) {
    addLog_(
      roomData,
      player.name,
      'AI 行動決策：「' +
        card.name +
        '」；原因：' +
        (
          actionChoice.reason ||
          '行動評分最高'
        ) +
        '（評分：' +
        (
          Math.round(
            Number(
              actionChoice.score || 0
            ) * 10
          ) / 10
        ) +
        '）'
    );
  }

  addLog_(
    roomData,
    player.name,
    '打出「' +
      card.name +
      '」' +
      (
        result &&
        result.summary &&
        result.summary.length
          ? '：' +
            result.summary.join('、')
          : ''
      )
  );
}

function finishAiAction_(
  roomData,
  player
) {
  player.actionFinished = true;

  addLog_(
    roomData,
    player.name,
    '完成行動階段'
  );

  advanceActionIndex_(roomData);
}

function advanceActionIndex_(roomData) {
  roomData.actionIndex =
    Number(roomData.actionIndex || 0) + 1;

  while (
    roomData.actionIndex <
      roomData.players.length &&
    roomData.players[
      roomData.actionIndex
    ].actionFinished
  ) {
    roomData.actionIndex += 1;
  }

  if (
    roomData.actionIndex >=
    roomData.players.length
  ) {
    enterSimultaneousBuyPhase_(roomData);
  }
}


function getAiDifficultyProfile_(
  player
) {
  const difficulty =
    String(
      player.aiDifficulty || 'normal'
    ).toLowerCase();

  if (difficulty === 'easy') {
    return {
      name:'easy',
      candidatePool:4,
      randomness:26,
      strategyWeight:0.72,
      synergyWeight:0.72,
      endgameWeight:0.78
    };
  }

  if (difficulty === 'hard') {
    return {
      name:'hard',
      candidatePool:1,
      randomness:2,
      strategyWeight:1.18,
      synergyWeight:1.22,
      endgameWeight:1.22
    };
  }

  return {
    name:'normal',
    candidatePool:2,
    randomness:8,
    strategyWeight:1.00,
    synergyWeight:1.00,
    endgameWeight:1.00
  };
}

function getAiAllCardIds_(
  state
) {
  state = state || {};

  return []
    .concat(state.deck || [])
    .concat(state.hand || [])
    .concat(state.discard || [])
    .concat(state.play || []);
}

function getAiDeckMetrics_(
  roomData,
  player
) {
  const state =
    player.state || {};

  const ids =
    getAiAllCardIds_(state);

  const counts = {};

  let treasureValue = 0;
  let treasureCount = 0;
  let actionCount = 0;
  let terminalCount = 0;
  let villageCount = 0;
  let drawCount = 0;
  let attackCount = 0;
  let victoryCount = 0;
  let junkCount = 0;

  ids.forEach(function(cardId) {
    counts[cardId] =
      Number(counts[cardId] || 0) + 1;

    const card =
      getCardDefinition(cardId);

    if (!card) return;

    if (hasCardType_(card, 'treasure')) {
      treasureCount += 1;
      treasureValue +=
        Number(card.coin || 0);
    }

    if (hasCardType_(card, 'action')) {
      actionCount += 1;

      if (Number(card.actions || 0) > 0) {
        villageCount += 1;
      } else {
        terminalCount += 1;
      }

      if (Number(card.cards || 0) > 0) {
        drawCount += 1;
      }

      if (
        hasCardType_(card, 'attack') ||
        [
          'witch',
          'militia',
          'bureaucrat',
          'spy',
          'thief'
        ].indexOf(cardId) !== -1
      ) {
        attackCount += 1;
      }
    }

    if (hasCardType_(card, 'victory')) {
      victoryCount += 1;
    }

    if (
      cardId === 'curse' ||
      cardId === 'estate' ||
      cardId === 'copper'
    ) {
      junkCount += 1;
    }
  });

  const totalCards =
    Math.max(1, ids.length);

  const provinceLeft =
    Number(
      roomData.supply &&
      roomData.supply.province != null
        ? roomData.supply.province
        : 8
    );

  const emptyPiles =
    Object.keys(
      roomData.supply || {}
    ).filter(function(cardId) {
      return (
        Number(
          roomData.supply[cardId] || 0
        ) <= 0
      );
    }).length;

  const progressByProvince =
    Math.max(
      0,
      Math.min(
        1,
        (8 - provinceLeft) / 8
      )
    );

  const progressByPiles =
    Math.max(
      0,
      Math.min(
        1,
        emptyPiles / 3
      )
    );

  return {
    counts:counts,
    totalCards:totalCards,
    treasureValue:treasureValue,
    treasureCount:treasureCount,
    averageTreasure:
      treasureCount
        ? treasureValue / treasureCount
        : 0,
    actionCount:actionCount,
    terminalCount:terminalCount,
    villageCount:villageCount,
    drawCount:drawCount,
    attackCount:attackCount,
    victoryCount:victoryCount,
    junkCount:junkCount,
    actionDensity:
      actionCount / totalCards,
    terminalPressure:
      Math.max(
        0,
        terminalCount - villageCount
      ),
    provinceLeft:provinceLeft,
    emptyPiles:emptyPiles,
    gameProgress:
      Math.max(
        progressByProvince,
        progressByPiles
      )
  };
}

function chooseAiDeckStrategy_(
  roomData,
  player,
  metrics
) {
  const available =
    Object.keys(
      roomData.supply || {}
    ).filter(function(cardId) {
      return Number(
        roomData.supply[cardId] || 0
      ) > 0;
    });

  const hasAny = function(ids) {
    return ids.some(function(id) {
      return available.indexOf(id) !== -1;
    });
  };

  if (
    metrics.gameProgress >= 0.72
  ) {
    return {
      id:'endgame',
      name:'終局搶分',
      reason:'行省或牌堆已接近結束'
    };
  }

  if (
    metrics.junkCount >= 7 &&
    hasAny([
      'chapel',
      'remodel',
      'mine',
      'moneylender'
    ])
  ) {
    return {
      id:'clean',
      name:'精簡牌組',
      reason:'牌組中的低價值牌偏多'
    };
  }

  if (
    hasAny([
      'witch',
      'militia',
      'spy',
      'thief',
      'bureaucrat'
    ]) &&
    metrics.attackCount < 2
  ) {
    return {
      id:'attack',
      name:'攻擊壓制',
      reason:'攻擊卡供應充足且牌組攻擊力不足'
    };
  }

  if (
    hasAny([
      'village',
      'market',
      'laboratory',
      'festival'
    ]) &&
    hasAny([
      'smithy',
      'council_room',
      'library',
      'witch'
    ])
  ) {
    return {
      id:'engine',
      name:'行動引擎',
      reason:'供應區具備增加行動與抽牌組合'
    };
  }

  return {
    id:'money',
    name:'大錢策略',
    reason:'優先提升穩定購買力'
  };
}

function getAiCardRole_(
  cardId,
  card
) {
  if (!card) return 'unknown';

  if (cardId === 'curse') {
    return 'curse';
  }

  if (hasCardType_(card, 'victory')) {
    return 'victory';
  }

  if (hasCardType_(card, 'treasure')) {
    return 'treasure';
  }

  if (
    hasCardType_(card, 'attack') ||
    [
      'witch',
      'militia',
      'bureaucrat',
      'spy',
      'thief'
    ].indexOf(cardId) !== -1
  ) {
    return 'attack';
  }

  if (
    Number(card.actions || 0) > 0
  ) {
    return 'village';
  }

  if (
    Number(card.cards || 0) > 0
  ) {
    return 'draw';
  }

  if (
    [
      'chapel',
      'remodel',
      'mine',
      'moneylender'
    ].indexOf(cardId) !== -1
  ) {
    return 'clean';
  }

  return hasCardType_(card, 'action')
    ? 'action'
    : 'other';
}

function getAiBasePurchaseScore_(
  cardId,
  card
) {
  const fixed = {
    province:330,
    gold:138,
    laboratory:132,
    market:126,
    festival:120,
    witch:118,
    village:112,
    council_room:108,
    smithy:104,
    militia:102,
    mine:98,
    library:96,
    throne_room:92,
    workshop:90,
    remodel:88,
    silver:86,
    moneylender:84,
    adventurer:82,
    spy:80,
    thief:78,
    bureaucrat:76,
    cellar:72,
    feast:70,
    woodcutter:66,
    moat:62,
    chapel:60,
    chancellor:48,
    duchy:34,
    estate:10,
    copper:-40,
    curse:-9999
  };

  if (fixed[cardId] != null) {
    return Number(fixed[cardId]);
  }

  return (
    Number(card.cost || 0) * 14 +
    Number(card.cards || 0) * 16 +
    Number(card.actions || 0) * 18 +
    Number(card.coin || 0) * 20 +
    Number(card.buys || 0) * 8 +
    Number(card.victoryPoints || 0) * 20
  );
}

function evaluateAiPurchase_(
  cardId,
  roomData,
  player,
  options
) {
  options = options || {};

  const card =
    getCardDefinition(cardId);

  if (!card) {
    return {
      score:-9999,
      reason:'找不到卡片',
      role:'unknown'
    };
  }

  if (
    options.allowedType &&
    !hasCardType_(
      card,
      options.allowedType
    )
  ) {
    return {
      score:-9999,
      reason:'卡片類型不符合',
      role:'invalid'
    };
  }

  if (cardId === 'curse') {
    return {
      score:-9999,
      reason:'不主動取得詛咒',
      role:'curse'
    };
  }

  const profile =
    getAiDifficultyProfile_(player);

  const metrics =
    getAiDeckMetrics_(
      roomData,
      player
    );

  const strategy =
    chooseAiDeckStrategy_(
      roomData,
      player,
      metrics
    );

  const role =
    getAiCardRole_(
      cardId,
      card
    );

  const owned =
    Number(
      metrics.counts[cardId] || 0
    );

  let score =
    getAiBasePurchaseScore_(
      cardId,
      card
    );

  let reason =
    '平衡強化牌組';

  if (role === 'treasure') {
    score +=
      Number(card.coin || 0) * 30;

    if (metrics.averageTreasure < 1.6) {
      score += 34;
    }

    reason = '提升牌組購買力';
  }

  if (role === 'victory') {
    if (cardId === 'province') {
      score +=
        (
          150 +
          metrics.gameProgress * 160
        ) *
        profile.endgameWeight;

      reason = '購買行省取得高分';
    } else if (cardId === 'duchy') {
      score +=
        (
          metrics.gameProgress >= 0.58
            ? 100 +
              metrics.gameProgress * 90
            : -90
        ) *
        profile.endgameWeight;

      reason =
        metrics.gameProgress >= 0.58
          ? '進入終局，公國價值提高'
          : '前中期避免過早購買公國';
    } else if (cardId === 'estate') {
      score +=
        (
          metrics.gameProgress >= 0.82
            ? 70
            : -110
        ) *
        profile.endgameWeight;

      reason =
        metrics.gameProgress >= 0.82
          ? '遊戲將結束，補最後分數'
          : '避免莊園稀釋牌組';
    }
  }

  if (role === 'village') {
    if (metrics.terminalPressure > 0) {
      score +=
        (
          42 +
          metrics.terminalPressure * 18
        ) *
        profile.synergyWeight;

      reason =
        '終端行動卡較多，需要增加行動次數';
    } else if (
      metrics.villageCount >
      metrics.terminalCount + 2
    ) {
      score -= 45;
      reason =
        '增加行動的卡片已足夠';
    }
  }

  if (role === 'draw') {
    if (metrics.villageCount > 0) {
      score +=
        34 *
        profile.synergyWeight;

      reason =
        '已有行動支援，增加抽牌能力';
    }

    if (
      metrics.terminalPressure >= 2 &&
      metrics.villageCount === 0
    ) {
      score -= 36;
      reason =
        '缺少增加行動卡，暫時降低終端抽牌牌';
    }
  }

  if (role === 'attack') {
    score +=
      (
        metrics.attackCount < 2
          ? 45
          : -owned * 14
      ) *
      profile.synergyWeight;

    reason =
      metrics.attackCount < 2
        ? '增加對手壓力'
        : '攻擊卡已足夠';
  }

  if (role === 'clean') {
    if (metrics.junkCount >= 7) {
      score +=
        100 *
        profile.synergyWeight;

      reason =
        '低價值牌偏多，優先精簡牌組';
    } else if (metrics.junkCount >= 4) {
      score +=
        45 *
        profile.synergyWeight;

      reason =
        '牌組仍有低價值牌可清理';
    } else {
      score -= 35;
    }
  }

  if (cardId === 'chapel') {
    if (owned >= 1) {
      score = -9999;
      reason = '已經擁有禮拜堂';
    } else if (metrics.junkCount >= 5) {
      score += 80;
      reason = '第一張禮拜堂能快速清理廢牌';
    }
  }

  if (cardId === 'throne_room') {
    if (metrics.actionCount < 4) {
      score -= 110;
      reason =
        '行動卡太少，寶座廳缺乏目標';
    } else {
      score +=
        (
          metrics.drawCount +
          metrics.attackCount +
          metrics.villageCount
        ) * 12;

      reason =
        '牌組已有值得重複的行動卡';
    }
  }

  if (cardId === 'gardens') {
    score +=
      Math.floor(
        metrics.totalCards / 10
      ) * 45;

    reason =
      metrics.totalCards >= 25
        ? '厚牌組適合花園計分'
        : '依牌組厚度評估花園';
  }

  if (strategy.id === 'engine') {
    if (
      role === 'village' ||
      role === 'draw'
    ) {
      score +=
        52 *
        profile.strategyWeight;

      reason =
        '行動引擎策略需要行動與抽牌';
    }

    if (role === 'treasure') {
      score -= 8;
    }
  }

  if (strategy.id === 'attack') {
    if (role === 'attack') {
      score +=
        58 *
        profile.strategyWeight;

      reason =
        '攻擊壓制策略優先取得攻擊牌';
    }
  }

  if (strategy.id === 'clean') {
    if (role === 'clean') {
      score +=
        65 *
        profile.strategyWeight;

      reason =
        '精簡策略優先移除低價值牌';
    }
  }

  if (strategy.id === 'money') {
    if (role === 'treasure') {
      score +=
        34 *
        profile.strategyWeight;

      reason =
        '大錢策略優先提升經濟';
    }
  }

  if (strategy.id === 'endgame') {
    if (role === 'victory') {
      score +=
        70 *
        profile.strategyWeight;

      reason =
        '終局策略優先取得勝利分';
    }
  }

  if (
    hasCardType_(card, 'action')
  ) {
    const softCap =
      role === 'village'
        ? 4
        : (
            role === 'attack'
              ? 3
              : 3
          );

    if (owned >= softCap) {
      score -=
        40 +
        (owned - softCap + 1) * 22;

      reason =
        '避免同類行動卡過量';
    }
  }

  if (
    options.isGain &&
    Number(options.maxCost || 0) > 0
  ) {
    score -=
      Math.max(
        0,
        Number(options.maxCost || 0) -
        Number(card.cost || 0)
      ) * 4;
  }

  score +=
    (
      Math.random() - 0.5
    ) *
    profile.randomness;

  return {
    score:score,
    reason:reason,
    role:role,
    strategy:strategy
  };
}

function getAiBuyScore_(
  cardId,
  roomData,
  player,
  options
) {
  return Number(
    evaluateAiPurchase_(
      cardId,
      roomData,
      player,
      options || {}
    ).score
  );
}

function rankAiPurchaseCandidates_(
  roomData,
  player,
  options
) {
  options = options || {};

  const maxCost =
    Number(
      options.maxCost != null
        ? options.maxCost
        : player.state.coins || 0
    );

  return Object.keys(
    roomData.supply || {}
  )
    .filter(function(cardId) {
      const card =
        getCardDefinition(cardId);

      return Boolean(
        card &&
        Number(
          roomData.supply[cardId] || 0
        ) > 0 &&
        Number(card.cost || 0) <=
          maxCost &&
        (
          !options.allowedType ||
          hasCardType_(
            card,
            options.allowedType
          )
        )
      );
    })
    .map(function(cardId) {
      const evaluation =
        evaluateAiPurchase_(
          cardId,
          roomData,
          player,
          options
        );

      return {
        cardId:cardId,
        score:
          Number(
            evaluation.score || -9999
          ),
        reason:
          evaluation.reason || '',
        role:
          evaluation.role || '',
        strategy:
          evaluation.strategy || null
      };
    })
    .filter(function(item) {
      return item.score > -9000;
    })
    .sort(function(a, b) {
      return b.score - a.score;
    });
}

function chooseAiPurchaseCard_(
  roomData,
  player
) {
  const candidates =
    rankAiPurchaseCandidates_(
      roomData,
      player,
      {
        maxCost:
          Number(
            player.state.coins || 0
          ),
        isGain:false
      }
    );

  if (!candidates.length) {
    return null;
  }

  const profile =
    getAiDifficultyProfile_(player);

  const poolSize =
    Math.max(
      1,
      Math.min(
        Number(
          profile.candidatePool || 1
        ),
        candidates.length
      )
    );

  return poolSize === 1
    ? candidates[0]
    : candidates[
        Math.floor(
          Math.random() * poolSize
        )
      ];
}

function chooseAiSupplyCard_(
  roomData,
  player,
  interaction
) {
  const candidates =
    rankAiPurchaseCandidates_(
      roomData,
      player,
      {
        maxCost:
          Number(
            interaction.maxCost || 0
          ),
        allowedType:
          interaction.allowedType || '',
        isGain:true
      }
    );

  return candidates.length
    ? candidates[0].cardId
    : '';
}

function hasGainCandidate_(
  roomData,
  maxCost,
  allowedType
) {
  return Object.keys(
    roomData.supply || {}
  ).some(function(cardId) {
    const card =
      getCardDefinition(cardId);

    return Boolean(
      card &&
      Number(
        roomData.supply[cardId] || 0
      ) > 0 &&
      Number(card.cost || 0) <=
        Number(maxCost || 0) &&
      (
        !allowedType ||
        hasCardType_(
          card,
          allowedType
        )
      )
    );
  });
}


function processAiPurchase_(roomData) {
  const player =
    roomData.players.find(function(item) {
      return (
        isAiControlledPlayer_(item) &&
        !item.buyFinished
      );
    });

  if (
    !player ||
    !player.state
  ) {
    return;
  }

  if (
    Number(player.state.buys || 0) <= 0
  ) {
    finishAiPurchase_(
      roomData,
      player
    );
    return;
  }

  const rankedCandidates =
    rankAiPurchaseCandidates_(
      roomData,
      player,
      {
        maxCost:
          Number(
            player.state.coins || 0
          ),
        isGain:false
      }
    );

  const purchaseChoice =
    chooseAiPurchaseCard_(
      roomData,
      player
    );

  const metrics =
    getAiDeckMetrics_(
      roomData,
      player
    );

  const strategy =
    chooseAiDeckStrategy_(
      roomData,
      player,
      metrics
    );

  player.lastAiPurchaseAnalysis = {
    createdAt:
      new Date().toISOString(),
    strategy:strategy,
    deckMetrics:{
      totalCards:metrics.totalCards,
      treasureValue:metrics.treasureValue,
      actionCount:metrics.actionCount,
      villageCount:metrics.villageCount,
      drawCount:metrics.drawCount,
      attackCount:metrics.attackCount,
      junkCount:metrics.junkCount,
      gameProgress:
        Math.round(
          metrics.gameProgress * 100
        ) / 100
    },
    coins:
      Number(
        player.state.coins || 0
      ),
    difficulty:
      player.aiDifficulty || 'normal',
    mode:
      player.aiControlMode ||
      'balanced',
    candidates:
      rankedCandidates
        .slice(0, 5)
        .map(function(item) {
          return {
            cardId:item.cardId,
            score:
              Math.round(
                item.score * 10
              ) / 10,
            reason:item.reason,
            role:item.role
          };
        })
  };

  if (!purchaseChoice) {
    addLog_(
      roomData,
      player.name,
      '沒有可購買卡片，結束購買階段'
    );

    finishAiPurchase_(
      roomData,
      player
    );
    return;
  }

  const cardId =
    purchaseChoice.cardId;

  const card =
    getCardDefinition(cardId);

  if (
    !card ||
    Number(
      roomData.supply[cardId] || 0
    ) <= 0 ||
    Number(player.state.coins || 0) <
      Number(card.cost || 0)
  ) {
    finishAiPurchase_(
      roomData,
      player
    );
    return;
  }

  player.state.coins -=
    Number(card.cost || 0);

  player.state.buys -= 1;
  player.state.discard.push(cardId);
  roomData.supply[cardId] -= 1;

  addLog_(
    roomData,
    player.name,
    '購買「' +
      card.name +
      '」；原因：' +
      (
        purchaseChoice.reason ||
        '一般牌組強化'
      ) +
      '（評分：' +
      (
        Math.round(
          Number(
            purchaseChoice.score || 0
          ) * 10
        ) / 10
      ) +
      '；策略：' +
      (
        purchaseChoice.strategy
          ? purchaseChoice.strategy.name
          : strategy.name
      ) +
      '）'
  );

  if (isGameOver(roomData)) {
    roomData.status = '遊戲結束';
    roomData.phase = 'finished';
    roomData.result =
      createGameResult(roomData);
  }
}

function finishAiPurchase_(
  roomData,
  player
) {
  player.buyFinished = true;

  addLog_(
    roomData,
    player.name,
    '完成購買'
  );

  finishRoundIfReady_(roomData);
}

function finishRoundIfReady_(roomData) {
  const allFinished =
    roomData.players.every(function(item) {
      return Boolean(item.buyFinished);
    });

  if (allFinished) {
    cleanupAllPlayers_(roomData);
    startNextRound_(roomData);
  }
}


function getAiCurrentHandItems_(
  player
) {
  return (player.state.hand || [])
    .map(function(cardId, index) {
      return {
        index:index,
        cardId:cardId,
        card:getCardDefinition(cardId)
      };
    })
    .filter(function(item) {
      return Boolean(item.card);
    });
}

function isAiActionUseful_(
  roomData,
  player,
  cardId,
  cardIndex
) {
  const state =
    player.state || {};

  const hand =
    state.hand || [];

  if (cardId === 'throne_room') {
    return hand.some(function(
      otherCardId,
      otherIndex
    ) {
      if (otherIndex === cardIndex) {
        return false;
      }

      const otherCard =
        getCardDefinition(otherCardId);

      return Boolean(
        otherCard &&
        hasCardType_(
          otherCard,
          'action'
        )
      );
    });
  }

  if (cardId === 'moneylender') {
    return hand.indexOf('copper') !== -1;
  }

  if (cardId === 'mine') {
    return hand.some(function(id) {
      const card =
        getCardDefinition(id);

      return Boolean(
        card &&
        hasCardType_(card, 'treasure')
      );
    });
  }

  if (cardId === 'feast') {
    return hasGainCandidate_(
      roomData,
      5,
      ''
    );
  }

  if (cardId === 'workshop') {
    return hasGainCandidate_(
      roomData,
      4,
      ''
    );
  }

  if (cardId === 'chapel') {
    return countAiJunkCards_(state) > 0;
  }

  if (cardId === 'cellar') {
    return countAiLowValueHandCards_(
      state
    ) > 0;
  }

  if (cardId === 'remodel') {
    return hand.length > 1;
  }

  return true;
}

function evaluateAiActionCard_(
  roomData,
  player,
  cardId,
  cardIndex
) {
  const card =
    getCardDefinition(cardId);

  if (
    !card ||
    !hasCardType_(card, 'action')
  ) {
    return {
      score:-9999,
      reason:'不是可執行的行動卡'
    };
  }

  if (
    !isAiActionUseful_(
      roomData,
      player,
      cardId,
      cardIndex
    )
  ) {
    return {
      score:-9999,
      reason:'目前無法產生有效效果'
    };
  }

  const state =
    player.state || {};

  const handItems =
    getAiCurrentHandItems_(player);

  const otherActions =
    handItems.filter(function(item) {
      return (
        item.index !== cardIndex &&
        item.card &&
        hasCardType_(
          item.card,
          'action'
        )
      );
    }).length;

  const base = {
    laboratory:112,
    market:108,
    village:103,
    festival:100,
    witch:96,
    council_room:92,
    smithy:90,
    library:88,
    militia:86,
    spy:84,
    bureaucrat:82,
    thief:80,
    workshop:78,
    mine:76,
    remodel:74,
    moneylender:72,
    adventurer:70,
    feast:68,
    chapel:66,
    cellar:64,
    woodcutter:60,
    moat:54,
    chancellor:42,
    throne_room:38
  };

  let score =
    Number(base[cardId] || 35);

  let reason =
    '行動牌綜合評分最高';

  const cardsDrawn =
    Number(card.cards || 0);

  const extraActions =
    Number(card.actions || 0);

  const extraCoins =
    Number(card.coin || 0);

  const extraBuys =
    Number(card.buys || 0);

  score +=
    cardsDrawn * 17 +
    extraActions * 22 +
    extraCoins * 13 +
    extraBuys * 7;

  if (
    extraActions > 0 &&
    otherActions > 0
  ) {
    score +=
      28 +
      otherActions * 8;

    reason =
      '手牌仍有行動卡，優先增加行動次數';
  }

  if (
    cardsDrawn > 0 &&
    handItems.length <= 5
  ) {
    score += 20;
    reason =
      '目前手牌較少，優先增加抽牌';
  }

  if (
    Number(state.actions || 0) <= 1 &&
    extraActions <= 0 &&
    otherActions >= 2
  ) {
    score -=
      30 +
      otherActions * 7;

    reason =
      '避免終端行動卡讓其他行動牌無法使用';
  }

  if (
    [
      'witch',
      'militia',
      'bureaucrat',
      'spy',
      'thief'
    ].indexOf(cardId) !== -1 ||
    hasCardType_(card, 'attack')
  ) {
    score += 26;
    reason =
      '攻擊效果可削弱其他玩家';
  }

  if (cardId === 'chapel') {
    const junk =
      countAiJunkCards_(state);

    score += junk * 24;
    reason =
      '移除廢牌，提升牌組品質';
  }

  if (cardId === 'cellar') {
    const lowValue =
      countAiLowValueHandCards_(
        state
      );

    score += lowValue * 15;
    reason =
      '棄掉低價值手牌並重新抽牌';
  }

  if (cardId === 'moneylender') {
    score += 48;
    reason =
      '移除銅錢並增加三金錢';
  }

  if (cardId === 'mine') {
    score += 42;
    reason =
      '將手牌中的寶物升級';
  }

  if (cardId === 'remodel') {
    score +=
      countAiJunkCards_(state) * 12;

    reason =
      '將低價值卡轉換成更高費用卡';
  }

  if (cardId === 'library') {
    if (handItems.length < 7) {
      score +=
        (7 - handItems.length) * 11;

      reason =
        '手牌不足七張，圖書館抽牌價值高';
    } else {
      score -= 55;
    }
  }

  if (cardId === 'throne_room') {
    const target =
      chooseAiThroneTarget_(
        roomData,
        player,
        cardIndex
      );

    if (!target) {
      return {
        score:-9999,
        reason:'寶座廳沒有合法目標'
      };
    }

    score +=
      target.score * 0.68;

    reason =
      '寶座廳可重複「' +
      (
        target.card
          ? target.card.name
          : target.cardId
      ) +
      '」';
  }

  if (
    player.aiDifficulty === 'easy'
  ) {
    score += Math.random() * 30;
  } else if (
    player.aiDifficulty === 'normal'
  ) {
    score += Math.random() * 10;
  } else {
    score += Math.random() * 3;
  }

  return {
    score:score,
    reason:reason
  };
}

function rankAiActionCandidates_(
  roomData,
  player
) {
  return getAiCurrentHandItems_(
    player
  )
    .filter(function(item) {
      return (
        item.card &&
        hasCardType_(
          item.card,
          'action'
        )
      );
    })
    .map(function(item) {
      const evaluation =
        evaluateAiActionCard_(
          roomData,
          player,
          item.cardId,
          item.index
        );

      return {
        index:item.index,
        cardId:item.cardId,
        card:item.card,
        score:
          Number(
            evaluation.score || -9999
          ),
        reason:
          evaluation.reason || ''
      };
    })
    .filter(function(item) {
      return item.score > -9000;
    })
    .sort(function(a, b) {
      return b.score - a.score;
    });
}

function chooseAiActionChoice_(
  roomData,
  player
) {
  const candidates =
    rankAiActionCandidates_(
      roomData,
      player
    );

  player.lastAiActionAnalysis = {
    createdAt:
      new Date().toISOString(),
    remainingActions:
      Number(
        player.state.actions || 0
      ),
    candidates:
      candidates
        .slice(0, 5)
        .map(function(item) {
          return {
            cardId:item.cardId,
            score:
              Math.round(
                item.score * 10
              ) / 10,
            reason:item.reason
          };
        })
  };

  if (!candidates.length) {
    return null;
  }

  const profile =
    getAiDifficultyProfile_(player);

  const poolSize =
    Math.max(
      1,
      Math.min(
        Number(
          profile.candidatePool || 1
        ),
        candidates.length
      )
    );

  return poolSize === 1
    ? candidates[0]
    : candidates[
        Math.floor(
          Math.random() * poolSize
        )
      ];
}

function chooseAiActionIndex_(
  roomData,
  player
) {
  const choice =
    chooseAiActionChoice_(
      roomData,
      player
    );

  return choice
    ? choice.index
    : -1;
}

function chooseAiThroneTarget_(
  roomData,
  player,
  throneIndex
) {
  const candidates =
    getAiCurrentHandItems_(
      player
    )
      .filter(function(item) {
        return (
          item.index !== throneIndex &&
          item.cardId !== 'throne_room' &&
          item.card &&
          hasCardType_(
            item.card,
            'action'
          ) &&
          isAiActionUseful_(
            roomData,
            player,
            item.cardId,
            item.index
          )
        );
      })
      .map(function(item) {
        const evaluation =
          evaluateAiActionCard_(
            roomData,
            player,
            item.cardId,
            item.index
          );

        let score =
          Number(
            evaluation.score || 0
          );

        if (
          [
            'laboratory',
            'market',
            'witch',
            'smithy',
            'village',
            'militia',
            'spy',
            'thief'
          ].indexOf(item.cardId) !== -1
        ) {
          score += 26;
        }

        if (
          [
            'chapel',
            'moneylender',
            'mine',
            'remodel'
          ].indexOf(item.cardId) !== -1
        ) {
          score -= 14;
        }

        return {
          index:item.index,
          cardId:item.cardId,
          card:item.card,
          score:score,
          reason:
            evaluation.reason || ''
        };
      })
      .sort(function(a, b) {
        return b.score - a.score;
      });

  return candidates.length
    ? candidates[0]
    : null;
}

function canAiPlayAction_(
  roomData,
  player,
  cardId,
  cardIndex
) {
  return isAiActionUseful_(
    roomData,
    player,
    cardId,
    cardIndex
  );
}

function getAiActionScore_(
  roomData,
  player,
  cardId
) {
  const index =
    (player.state.hand || [])
      .indexOf(cardId);

  return Number(
    evaluateAiActionCard_(
      roomData,
      player,
      cardId,
      index
    ).score
  );
}

function getAiRepeatActionScore_(
  cardId,
  player,
  roomData
) {
  const index =
    (player.state.hand || [])
      .indexOf(cardId);

  return Number(
    evaluateAiActionCard_(
      roomData || {supply:{}},
      player,
      cardId,
      index
    ).score
  );
}


function chooseAiDiscardIndexes_(
  player,
  count
) {
  return player.state.hand
    .map(function(cardId, index) {
      return {
        index:index,
        score:getAiKeepScore_(
          cardId,
          player
        )
      };
    })
    .sort(function(a, b) {
      return a.score - b.score;
    })
    .slice(
      0,
      Math.min(
        count,
        player.state.hand.length
      )
    )
    .map(function(item) {
      return item.index;
    })
    .sort(function(a, b) {
      return b - a;
    });
}

function chooseAiHandIndexes_(
  player,
  interaction
) {
  const cards =
    getEligibleAiHandCards_(
      player,
      interaction
    );

  const maximum =
    Math.max(
      0,
      Number(
        interaction.max == null
          ? cards.length
          : interaction.max
      )
    );

  if (interaction.mode === 'trash') {
    return cards
      .sort(function(a, b) {
        return (
          getAiTrashPriority_(
            b.cardId,
            player
          ) -
          getAiTrashPriority_(
            a.cardId,
            player
          )
        );
      })
      .filter(function(item) {
        return (
          getAiTrashPriority_(
            item.cardId,
            player
          ) > 0
        );
      })
      .slice(0, maximum)
      .map(function(item) {
        return item.index;
      })
      .sort(function(a, b) {
        return b - a;
      });
  }

  if (
    interaction.mode ===
    'discardDraw'
  ) {
    return cards
      .filter(function(item) {
        return (
          getAiKeepScore_(
            item.cardId,
            player
          ) < 22
        );
      })
      .slice(0, maximum)
      .map(function(item) {
        return item.index;
      })
      .sort(function(a, b) {
        return b - a;
      });
  }

  if (
    interaction.mode ===
    'trashThenGain'
  ) {
    cards.sort(function(a, b) {
      return (
        getAiKeepScore_(
          a.cardId,
          player
        ) -
        getAiKeepScore_(
          b.cardId,
          player
        )
      );
    });

    return cards.length
      ? [cards[0].index]
      : [];
  }

  if (
    interaction.mode ===
    'repeatAction'
  ) {
    const target =
      chooseAiThroneTarget_(
        {
          supply:{}
        },
        player,
        -1
      );

    return target
      ? [target.index]
      : [];
  }

  if (
    interaction.mode === 'topDeck'
  ) {
    const victoryCards =
      cards
        .filter(function(item) {
          return (
            item.card &&
            hasCardType_(item.card, 'victory')
          );
        })
        .sort(function(a, b) {
          return (
            Number(
              a.card.victoryPoints || 0
            ) -
            Number(
              b.card.victoryPoints || 0
            )
          );
        });

    return victoryCards.length
      ? [victoryCards[0].index]
      : [];
  }

  return [];
}

function chooseRequiredHandIndexes_(
  player,
  interaction,
  minimum
) {
  const cards =
    getEligibleAiHandCards_(
      player,
      interaction
    );

  return cards
    .sort(function(a, b) {
      return (
        getAiKeepScore_(
          a.cardId,
          player
        ) -
        getAiKeepScore_(
          b.cardId,
          player
        )
      );
    })
    .slice(0, minimum)
    .map(function(item) {
      return item.index;
    })
    .sort(function(a, b) {
      return b - a;
    });
}

function getEligibleAiHandCards_(
  player,
  interaction
) {
  return player.state.hand
    .map(function(cardId, index) {
      return {
        index:index,
        cardId:cardId,
        card:getCardDefinition(cardId)
      };
    })
    .filter(function(item) {
      return (
        !interaction.allowedType ||
        (
          item.card &&
          hasCardType_(
            item.card,
            interaction.allowedType
          )
        )
      );
    });
}

function getAiRepeatActionScore_(
  cardId,
  player
) {
  const scores = {
    laboratory:120,
    market:115,
    festival:110,
    village:106,
    witch:104,
    council_room:100,
    smithy:96,
    militia:92,
    workshop:88,
    mine:84,
    remodel:80,
    moneylender:78,
    spy:76,
    thief:74,
    adventurer:72,
    library:70,
    cellar:66,
    woodcutter:62,
    moat:50,
    feast:48,
    bureaucrat:46,
    chancellor:40,
    chapel:36,
    throne_room:5
  };

  let score =
    Number(scores[cardId] || 30);

  if (
    cardId === 'throne_room'
  ) {
    score = 5;
  }

  if (
    player.aiDifficulty === 'easy'
  ) {
    score += Math.random() * 25;
  }

  return score;
}

function getAiKeepScore_(
  cardId,
  player
) {
  const card =
    getCardDefinition(cardId);

  if (!card) return 0;
  if (cardId === 'curse') return -60;
  if (cardId === 'estate') return -20;
  if (cardId === 'copper') return 8;

  if (hasCardType_(card, 'treasure')) {
    return 30 +
      Number(card.coin || 0) * 18;
  }

  if (hasCardType_(card, 'action')) {
    return 45 +
      Number(card.cost || 0) * 5;
  }

  if (hasCardType_(card, 'victory')) {
    return (
      Number(
        card.victoryPoints || 0
      ) * 12
    );
  }

  return 15;
}

function getAiTrashPriority_(
  cardId,
  player
) {
  if (cardId === 'curse') return 120;
  if (cardId === 'estate') return 80;

  if (cardId === 'copper') {
    const copperCount =
      countCardInState_(
        player.state,
        'copper'
      );

    return copperCount > 2
      ? 55
      : 10;
  }

  return 0;
}

function countAiJunkCards_(state) {
  return (
    countCardInState_(state, 'curse') +
    countCardInState_(state, 'estate') +
    Math.max(
      0,
      countCardInState_(state, 'copper') - 2
    )
  );
}

function countAiLowValueHandCards_(state) {
  return state.hand.filter(function(cardId) {
    return (
      cardId === 'curse' ||
      cardId === 'estate' ||
      cardId === 'copper'
    );
  }).length;
}

function countCardInState_(
  state,
  cardId
) {
  return []
    .concat(state.deck || [])
    .concat(state.hand || [])
    .concat(state.discard || [])
    .concat(state.play || [])
    .filter(function(id) {
      return id === cardId;
    })
    .length;
}

function countActionCardsInState_(state) {
  return []
    .concat(state.deck || [])
    .concat(state.hand || [])
    .concat(state.discard || [])
    .concat(state.play || [])
    .filter(function(cardId) {
      const card =
        getCardDefinition(cardId);

      return (
        card &&
        hasCardType_(card, 'action')
      );
    })
    .length;
}

function getAiTotalCardCount_(state) {
  return (
    (state.deck || []).length +
    (state.hand || []).length +
    (state.discard || []).length +
    (state.play || []).length
  );
}
