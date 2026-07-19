function initializeMultiplayerGame_(roomData) {
  roomData.players.forEach(function(player) {
    player.state = createInitialPlayerState_();
    drawCards_(player.state, 5);
    player.actionFinished = false;
    player.buyFinished = false;
  });

  roomData.status = '遊戲中';
  roomData.phase = 'action';
  roomData.actionIndex = 0;
  roomData.roundNumber = 1;
  roomData.supply =
    createSupplyFromCardDefinitions(
      roomData.players.length,
      roomData.kingdomCardIds
    );
  roomData.interactionQueue = [];
  roomData.log = [];
  roomData.result = null;

  addLog_(
    roomData,
    '系統',
    '遊戲開始，共 ' +
      roomData.players.length +
      ' 位玩家'
  );
}

function createInitialPlayerState_() {
  const cards = [];

  for (let i = 0; i < 7; i++) {
    cards.push('copper');
  }

  for (let i = 0; i < 3; i++) {
    cards.push('estate');
  }

  return {
    deck:shuffleArray_(cards),
    hand:[],
    discard:[],
    play:[],
    actions:1,
    buys:1,
    coins:0
  };
}

function shuffleArray_(array) {
  const result = array.slice();

  for (let i = result.length - 1; i > 0; i--) {
    const randomIndex =
      Math.floor(
        Math.random() * (i + 1)
      );

    const temp = result[i];
    result[i] = result[randomIndex];
    result[randomIndex] = temp;
  }

  return result;
}

function drawCards_(
  playerState,
  numberOfCards
) {
  for (let i = 0; i < numberOfCards; i++) {
    if (playerState.deck.length === 0) {
      if (playerState.discard.length === 0) {
        break;
      }

      playerState.deck =
        shuffleArray_(playerState.discard);

      playerState.discard = [];
    }

    playerState.hand.push(
      playerState.deck.shift()
    );
  }
}

function getGameState(roomNumber, playerId) {
  const context = loadRoomContext_(roomNumber);
  const roomData = context.roomData;

  const playerIndex =
    roomData.players.findIndex(function(player) {
      return player.id === playerId;
    });

  if (playerIndex === -1) {
    throw new Error('你不是這個房間的玩家。');
  }

  const ownPlayer =
    roomData.players[playerIndex];

  const currentInteraction =
    getCurrentInteraction_(roomData);

  const activeActionPlayer =
    roomData.players[roomData.actionIndex] || null;

  return {
    success:true,
    initialized:
      roomData.status === '遊戲中' ||
      roomData.status === '遊戲結束',
    roomNumber:roomData.roomNumber,
    status:roomData.status,
    phase:roomData.phase,
    roundNumber:roomData.roundNumber,
    maxPlayers:roomData.maxPlayers,
    playerCount:roomData.players.length,
    playerIndex:playerIndex,
    activeActionPlayerId:
      activeActionPlayer
        ? activeActionPlayer.id
        : '',
    activeActionPlayerName:
      activeActionPlayer
        ? activeActionPlayer.name
        : '',
    isActionPlayer:
      roomData.phase === 'action' &&
      activeActionPlayer &&
      activeActionPlayer.id === playerId,
    canBuy:
      roomData.phase === 'buy' &&
      !ownPlayer.buyFinished &&
      !currentInteraction,
    buyFinished:Boolean(ownPlayer.buyFinished),

    player:{
      id:ownPlayer.id,
      name:ownPlayer.name,
      hand:ownPlayer.state.hand,
      play:ownPlayer.state.play,
      deckCount:ownPlayer.state.deck.length,
      discardCount:ownPlayer.state.discard.length,
      actions:ownPlayer.state.actions,
      buys:ownPlayer.state.buys,
      coins:ownPlayer.state.coins
    },

    players:roomData.players.map(function(player, index) {
      return {
        id:player.id,
        name:player.name,
        seat:index + 1,
        isHost:player.isHost,
        connected:player.connected !== false,
        handCount:
          player.state
            ? player.state.hand.length
            : 0,
        deckCount:
          player.state
            ? player.state.deck.length
            : 0,
        discardCount:
          player.state
            ? player.state.discard.length
            : 0,
        actionFinished:
          Boolean(player.actionFinished),
        buyFinished:
          Boolean(player.buyFinished)
      };
    }),

    supply:roomData.supply,
    cardCatalog:getPublicCardCatalog(),
    interaction:currentInteraction,
    isInteractionPlayer:
      Boolean(currentInteraction) &&
      currentInteraction.playerId === playerId,
    gameOver:
      roomData.status === '遊戲結束',
    result:roomData.result,
    log:roomData.log.slice(-40),
    version:context.version
  };
}

function playActionCard(
  roomNumber,
  playerId,
  handIndex
) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;

    assertCanAct_(
      roomData,
      playerId
    );

    const actorIndex =
      roomData.actionIndex;

    const actor =
      roomData.players[actorIndex];

    handIndex = Number(handIndex);

    if (
      !Number.isInteger(handIndex) ||
      handIndex < 0 ||
      handIndex >= actor.state.hand.length
    ) {
      throw new Error('找不到這張手牌。');
    }

    if (actor.state.actions <= 0) {
      throw new Error('你已經沒有行動次數。');
    }

    const cardId =
      actor.state.hand[handIndex];

    const card =
      getCardDefinition(cardId);

    if (!card || !hasCardType_(card, 'action')) {
      throw new Error('這張牌不是行動卡。');
    }

    actor.state.actions -= 1;
    actor.state.hand.splice(handIndex, 1);
    actor.state.play.push(cardId);

    const result =
      applyCardEffects_(
        roomData,
        actorIndex,
        card
      );

    addLog_(
      roomData,
      actor.name,
      '打出「' +
        card.name +
        '」' +
        (
          result.summary.length > 0
            ? '：' +
              result.summary.join('、')
            : ''
        )
    );

    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      message:card.name + '已打出'
    };
  });
}


function finishCurrentPhaseWithState(
  roomNumber,
  playerId,
  phase
) {
  phase =
    cleanText(phase).toLowerCase();

  const result =
    phase === 'action'
      ? finishActionTurn(
          roomNumber,
          playerId
        )
      : finishBuyTurn(
          roomNumber,
          playerId
        );

  result.state =
    getClientState(
      roomNumber,
      playerId
    );

  return result;
}


function repairEffectStack(
  roomNumber,
  playerId
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData =
      context.roomData;

    const player =
      findPlayer_(roomData, playerId);

    if (!player) {
      throw new Error('找不到玩家。');
    }

    if (getCurrentInteraction_(roomData)) {
      return {
        success:true,
        repaired:false,
        message:'目前有待處理互動，不需要修復。',
        state:getClientState(
          roomNumber,
          playerId
        )
      };
    }

    const depth =
      Array.isArray(roomData.effectStack)
        ? roomData.effectStack.length
        : 0;

    if (depth <= 0) {
      return {
        success:true,
        repaired:false,
        message:'目前沒有待處理的效果堆疊。',
        state:getClientState(
          roomNumber,
          playerId
        )
      };
    }

    runEffectEngine_(roomData, 'game-resolution');
    saveRoomContext_(context);

    return {
      success:true,
      repaired:true,
      message:'已重新推進效果堆疊。',
      state:getClientState(
        roomNumber,
        playerId
      )
    };
  });
}

function finishActionTurn(
  roomNumber,
  playerId
) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;

    assertCanAct_(
      roomData,
      playerId
    );

    /*
     * V23.0.3：
     * 寶座廳、間諜、圖書館等牌效尚未完成時，
     * 絕對不能提前進入購買階段。
     */
    if (getCurrentInteraction_(roomData)) {
      throw new Error(
        '請先完成目前的卡片效果，才能結束行動階段。'
      );
    }

    if (
      Array.isArray(roomData.effectStack) &&
      roomData.effectStack.length > 0
    ) {
      runEffectEngine_(roomData, 'game-resolution');

      if (
        getCurrentInteraction_(roomData) ||
        roomData.effectStack.length > 0
      ) {
        saveRoomContext_(context);

        throw new Error(
          '卡片效果仍在執行中，請先完成效果。'
        );
      }
    }

    const player =
      roomData.players[roomData.actionIndex];

    player.actionFinished = true;

    addLog_(
      roomData,
      player.name,
      '完成行動階段'
    );

    roomData.actionIndex += 1;

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

    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      message:
        roomData.phase === 'buy'
          ? '所有玩家完成行動，進入同時購買階段'
          : '已換下一位玩家行動'
    };
  });
}

function enterSimultaneousBuyPhase_(roomData) {
  roomData.phase = 'buy';

  roomData.players.forEach(function(player) {
    player.buyFinished = false;
    autoPlayTreasures_(player.state);
  });

  addLog_(
    roomData,
    '系統',
    '進入同時購買階段，所有玩家的寶物已自動計算'
  );

  resetCurrentTimer_(roomData);
}

function buySupplyCard(
  roomNumber,
  playerId,
  cardId
) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;

    assertCanBuy_(
      roomData,
      playerId
    );

    const player =
      findPlayer_(roomData, playerId);

    cardId =
      cleanText(cardId).toLowerCase();

    const card =
      getCardDefinition(cardId);

    if (
      !card ||
      !(cardId in roomData.supply)
    ) {
      throw new Error('供應區沒有這張卡。');
    }

    if (
      Number(roomData.supply[cardId] || 0) <= 0
    ) {
      throw new Error(
        card.name +
        '剛剛已被其他玩家買完。'
      );
    }

    if (player.state.buys <= 0) {
      throw new Error('你已經沒有購買次數。');
    }

    if (player.state.coins < card.cost) {
      throw new Error('金錢不足。');
    }

    player.state.coins -= card.cost;
    player.state.buys -= 1;
    player.state.discard.push(cardId);
    roomData.supply[cardId] -= 1;

    addLog_(
      roomData,
      player.name,
      '購買「' + card.name + '」'
    );

    if (isGameOver(roomData)) {
      roomData.status = '遊戲結束';
      roomData.phase = 'finished';
      roomData.result =
        createGameResult(roomData);
    }

    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      gameOver:
        roomData.status === '遊戲結束',
      message:
        roomData.status === '遊戲結束'
          ? '購買完成，遊戲結束'
          : '購買完成'
    };
  });
}

function finishBuyTurn(
  roomNumber,
  playerId
) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;

    assertCanBuy_(
      roomData,
      playerId
    );

    const player =
      findPlayer_(roomData, playerId);

    player.buyFinished = true;

    addLog_(
      roomData,
      player.name,
      '完成購買'
    );

    const everyoneFinished =
      roomData.players.every(function(item) {
        return item.buyFinished;
      });

    if (everyoneFinished) {
      cleanupAllPlayers_(roomData);
      startNextRound_(roomData);
    }

    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      message:
        everyoneFinished
          ? '所有玩家購買完成，新回合開始'
          : '已完成購買，等待其他玩家'
    };
  });
}

function cleanupAllPlayers_(roomData) {
  roomData.players.forEach(function(player) {
    const state = player.state;

    state.discard = state.discard
      .concat(state.hand)
      .concat(state.play);

    state.hand = [];
    state.play = [];
    state.actions = 1;
    state.buys = 1;
    state.coins = 0;

    drawCards_(state, 5);
  });
}

function startNextRound_(roomData) {
  roomData.roundNumber += 1;
  roomData.phase = 'action';
  roomData.actionIndex = 0;
  roomData.interactionQueue = [];

  roomData.players.forEach(function(player) {
    player.actionFinished = false;
    player.buyFinished = false;
  });

  addLog_(
    roomData,
    '系統',
    '第 ' +
      roomData.roundNumber +
      ' 回合開始'
  );

  resetCurrentTimer_(roomData);
}

function autoPlayTreasures_(state) {
  const remainingHand = [];
  const treasures = [];

  state.hand.forEach(function(cardId) {
    const card =
      getCardDefinition(cardId);

    if (card && hasCardType_(card, 'treasure')) {
      state.coins +=
        Number(card.coin || 0);

      treasures.push(cardId);
    } else {
      remainingHand.push(cardId);
    }
  });

  state.hand = remainingHand;
  state.play =
    state.play.concat(treasures);
}

function respondToAttackReaction(
  roomNumber,
  playerId,
  revealMoat
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData =
      context.roomData;

    const interaction =
      getCurrentInteraction_(roomData);

    if (
      !interaction ||
      !isInteractionType_(
        interaction,
        'reaction'
      ) ||
      interaction.playerId !== playerId
    ) {
      throw new Error(
        '目前沒有等待你的反應。'
      );
    }

    const player =
      findPlayer_(
        roomData,
        playerId
      );

    if (!player) {
      throw new Error(
        '找不到防守玩家。'
      );
    }

    if (
      revealMoat &&
      player.state.hand
        .indexOf('moat') === -1
    ) {
      throw new Error(
        '手牌中沒有護城河。'
      );
    }

    resolveAttackReaction_(
      roomData,
      interaction,
      Boolean(revealMoat)
    );

    runEffectEngine_(
      roomData,
      revealMoat
        ? 'moat-revealed'
        : 'moat-declined'
    );

    resetPlayerTimer_(
      roomData,
      playerId
    );

    resetCurrentTimer_(
      roomData
    );

    saveRoomContext_(
      context
    );

    return {
      success:true,
      message:
        revealMoat
          ? '已展示護城河，攻擊無效'
          : '未展示護城河，繼續處理攻擊',
      state:getClientState(
        roomNumber,
        playerId
      )
    };
  });
}


function cancelCurrentInteraction(
  roomNumber,
  playerId
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData =
      context.roomData;

    const interaction =
      getCurrentInteraction_(roomData);

    if (
      !interaction ||
      interaction.playerId !== playerId
    ) {
      throw new Error('目前沒有可放棄的卡片效果。');
    }

    if (
      interaction.allowCancel === false ||
      interaction.type === 'discard' ||
      interaction.type === 'reaction'
    ) {
      throw new Error('這個效果不能放棄。');
    }

    const player =
      findPlayer_(roomData, playerId);

    if (!player) {
      throw new Error('找不到玩家。');
    }

    const sourceCard =
      getCardDefinition(
        interaction.sourceCardId
      );

    addLog_(
      roomData,
      player.name,
      '放棄「' +
        (
          sourceCard
            ? sourceCard.name
            : '卡片'
        ) +
        '」的選擇效果'
    );

    finalizeInteraction_(
      roomData,
      interaction,
      'militia-discard-complete'
    );

    continueAttackAfterInteraction_(
      roomData,
      interaction,
      'militia-discard-complete'
    );

    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      message:'已放棄卡片效果',
      state:getClientState(
        roomNumber,
        playerId
      )
    };
  });
}


function continueAttackAfterInteraction_(
  roomData,
  interaction,
  outcome
) {
  if (
    !interaction ||
    !interaction.attackSequenceId
  ) {
    return false;
  }

  const sequence =
    ensureAttackSequences_(roomData)
      .find(function(item) {
        return (
          item.attackSequenceId ===
          interaction.attackSequenceId
        );
      });

  if (!sequence) return false;

  completeAttackTarget_(
    roomData,
    sequence,
    outcome || interaction.type
  );

  continueAttackSequence_(
    roomData,
    sequence
  );

  return true;
}

function submitSpecialInteractionChoice(
  roomNumber,
  playerId,
  choice
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData =
      context.roomData;

    const interaction =
      getCurrentInteraction_(roomData);

    if (
      !interaction ||
      interaction.playerId !== playerId
    ) {
      throw new Error('目前沒有等待你的特殊卡片選擇。');
    }

    const actor =
      findPlayer_(roomData, playerId);

    if (!actor) {
      throw new Error('找不到做決定的玩家。');
    }

    if (interaction.type === 'spyDecision') {
      resolveSpyDecision_(
        roomData,
        actor,
        interaction,
        choice
      );

      finalizeInteraction_(
        roomData,
        interaction,
        'player-choice'
      );

      continueAttackAfterInteraction_(
        roomData,
        interaction,
        'spy-complete'
      );
    } else if (
      interaction.type === 'thiefTrashDecision'
    ) {
      resolveThiefTrashDecision_(
        roomData,
        actor,
        interaction,
        choice
      );

      finalizeInteraction_(
        roomData,
        interaction,
        'player-choice'
      );
    } else if (
      interaction.type === 'thiefGainDecision'
    ) {
      resolveThiefGainDecision_(
        roomData,
        actor,
        interaction,
        choice
      );

      finalizeInteraction_(
        roomData,
        interaction,
        'player-choice'
      );

      continueAttackAfterInteraction_(
        roomData,
        interaction,
        'thief-complete'
      );
    } else if (
      interaction.type === 'libraryDecision'
    ) {
      resolveLibraryDecision_(
        roomData,
        actor,
        interaction,
        choice
      );

      finalizeInteraction_(
        roomData,
        interaction,
        'player-choice'
      );
    } else {
      throw new Error(
        '這不是可處理的正式卡片互動。'
      );
    }
    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      message:'卡片效果已處理',
      state:getClientState(
        roomNumber,
        playerId
      )
    };
  });
}

function resolveSpyDecision_(
  roomData,
  actor,
  interaction,
  choice
) {
  const target =
    findPlayer_(
      roomData,
      interaction.targetPlayerId
    );

  if (!target || !target.state) {
    throw new Error('找不到間諜查看的玩家。');
  }

  const cardId =
    interaction.revealedCardId;

  const card =
    getCardDefinition(cardId);

  const action =
    cleanText(
      choice && choice.action
    ).toLowerCase();

  if (
    action !== 'keep' &&
    action !== 'discard'
  ) {
    throw new Error('請選擇保留或棄掉。');
  }

  if (action === 'keep') {
    target.state.deck.unshift(cardId);
  } else {
    target.state.discard.push(cardId);
  }

  addLog_(
    roomData,
    actor.name,
    '決定將' +
      (
        interaction.targetIsActor
          ? '自己的'
          : target.name + '的'
      ) +
      '「' +
      (card ? card.name : cardId) +
      '」' +
      (
        action === 'keep'
          ? '保留在牌庫頂'
          : '棄掉'
      )
  );
}

function resolveThiefTrashDecision_(
  roomData,
  actor,
  interaction,
  choice
) {
  const target =
    findPlayer_(
      roomData,
      interaction.targetPlayerId
    );

  if (!target || !target.state) {
    throw new Error(
      '找不到被小偷攻擊的玩家。'
    );
  }

  const selectedCardId =
    cleanText(
      choice && choice.cardId
    ).toLowerCase();

  const options =
    Array.isArray(
      interaction.treasureOptions
    )
      ? interaction.treasureOptions
      : [];

  if (
    options.indexOf(
      selectedCardId
    ) === -1
  ) {
    throw new Error(
      '必須選擇一張翻開的寶物移除。'
    );
  }

  const revealed =
    Array.isArray(
      interaction.revealedCardIds
    )
      ? interaction.revealedCardIds.slice()
      : [];

  let removed = false;
  const remaining = [];

  revealed.forEach(function(cardId) {
    if (
      !removed &&
      cardId === selectedCardId
    ) {
      removed = true;
    } else {
      remaining.push(cardId);
    }
  });

  target.state.discard =
    target.state.discard.concat(
      remaining
    );

  const card =
    getCardDefinition(
      selectedCardId
    );

  addLog_(
    roomData,
    actor.name,
    '選擇移除' +
      target.name +
      '的「' +
      (
        card
          ? card.name
          : selectedCardId
      ) +
      '」'
  );

  enqueueInteraction_(
    roomData,
    {
      type:'thiefGainDecision',
      playerId:actor.id,
      sourceCardId:'thief',
      targetPlayerId:target.id,
      targetPlayerName:target.name,
      trashedCardId:selectedCardId,
      allowCancel:false
    }
  );
}

function resolveThiefGainDecision_(
  roomData,
  actor,
  interaction,
  choice
) {
  const action =
    cleanText(
      choice && choice.action
    ).toLowerCase();

  if (
    action !== 'gain' &&
    action !== 'leave'
  ) {
    throw new Error(
      '請選擇是否獲得被移除的寶物。'
    );
  }

  const cardId =
    interaction.trashedCardId;

  const card =
    getCardDefinition(cardId);

  if (action === 'gain') {
    actor.state.discard.push(
      cardId
    );

    addLog_(
      roomData,
      actor.name,
      '獲得被「小偷」移除的「' +
        (card ? card.name : cardId) +
        '」'
    );
  } else {
    addLog_(
      roomData,
      actor.name,
      '不獲得被「小偷」移除的「' +
        (card ? card.name : cardId) +
        '」'
    );
  }
}

function resolveLibraryDecision_(
  roomData,
  actor,
  interaction,
  choice
) {
  const action =
    cleanText(
      choice && choice.action
    ).toLowerCase();

  if (
    action !== 'keep' &&
    action !== 'setaside'
  ) {
    throw new Error(
      '請選擇保留或旁置行動卡。'
    );
  }

  const cardId =
    interaction.revealedCardId;

  const card =
    getCardDefinition(cardId);

  if (action === 'keep') {
    actor.state.hand.push(
      cardId
    );

    addLog_(
      roomData,
      actor.name,
      '圖書館翻到「' +
        (card ? card.name : cardId) +
        '」，選擇保留在手牌'
    );
  } else {
    if (
      !Array.isArray(
        actor.state.librarySetAside
      )
    ) {
      actor.state.librarySetAside = [];
    }

    actor.state.librarySetAside.push(
      cardId
    );

    addLog_(
      roomData,
      actor.name,
      '圖書館翻到「' +
        (card ? card.name : cardId) +
        '」，選擇暫時旁置'
    );
  }
}

function submitAttackDiscardChoice(
  roomNumber,
  playerId,
  handIndexes
) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;
    const interaction =
      getCurrentInteraction_(roomData);

    if (
      !interaction ||
      interaction.type !== 'discard' ||
      interaction.playerId !== playerId
    ) {
      throw new Error('目前沒有等待你的棄牌。');
    }

    const player =
      findPlayer_(roomData, playerId);

    const indexes =
      normalizeIndexes_(handIndexes);

    const safeDiscardCount =
      Math.min(
        Number(interaction.requiredDiscardCount || 0),
        getSafeMilitiaDiscardCount_(player.state, 3)
      );

    if (indexes.length !== safeDiscardCount) {
      throw new Error('必須選擇 ' + safeDiscardCount + ' 張牌。');
    }

    removeHandCards_(
      player.state,
      indexes,
      'discard'
    );

    addLog_(
      roomData,
      player.name,
      '因民兵攻擊棄牌'
    );

    finalizeInteraction_(
      roomData,
      interaction,
      'militia-discard-complete'
    );

    continueAttackAfterInteraction_(
      roomData,
      interaction,
      'militia-discard-complete'
    );

    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      message:'已完成棄牌'
    };
  });
}

function submitSelectionChoice(
  roomNumber,
  playerId,
  selection
) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;
    const interaction =
      getCurrentInteraction_(roomData);

    if (
      !interaction ||
      interaction.playerId !== playerId
    ) {
      throw new Error('目前沒有等待你的選擇。');
    }

    const player =
      findPlayer_(roomData, playerId);

    if (interaction.type === 'selectSupply') {
      resolveSupplySelection_(
        roomData,
        player,
        interaction,
        selection
      );
    } else if (
      interaction.type === 'selectHand'
    ) {
      resolveHandSelection_(
        roomData,
        player,
        interaction,
        selection
      );
    } else {
      throw new Error('這不是通用選擇效果。');
    }

    completeCurrentInteraction_(roomData);

    /*
     * 寶座廳選定行動卡後，startThroneRepeat_ 只會建立
     * effectStack。這裡必須立刻 resume，才能在同一次請求
     * 產生間諜／小偷／圖書館等下一個互動。
     */
    if (
      !getCurrentInteraction_(roomData) &&
      Array.isArray(roomData.effectStack) &&
      roomData.effectStack.length > 0
    ) {
      runEffectEngine_(roomData, 'game-resolution');
    }

    resetPlayerTimer_(
      roomData,
      playerId
    );

    /*
     * 若操作後輪到其他玩家或產生互動，
     * 再重置目前真正需要思考者的時間。
     */
    resetCurrentTimer_(roomData);

    saveRoomContext_(context);

    return {
      success:true,
      message:
        getCurrentInteraction_(roomData)
          ? '選擇完成，請繼續處理卡片效果'
          : '選擇效果已完成',
      state:getClientState(
        roomNumber,
        playerId
      )
    };
  });
}

function resolveSupplySelection_(
  roomData,
  player,
  interaction,
  selection
) {
  const cardId =
    cleanText(
      selection && selection.cardId
    ).toLowerCase();

  const card =
    getCardDefinition(cardId);

  if (
    !card ||
    Number(roomData.supply[cardId] || 0) <= 0
  ) {
    throw new Error('這張卡不能選擇。');
  }

  if (card.cost > interaction.maxCost) {
    throw new Error('卡片費用超過限制。');
  }

  if (
    interaction.allowedType &&
    !hasCardType_(
      card,
      interaction.allowedType
    )
  ) {
    throw new Error('卡片類型不符合限制。');
  }

  gainCard_(
    roomData,
    player.state,
    cardId,
    interaction.destination || 'discard'
  );

  addLog_(
    roomData,
    player.name,
    '獲得「' + card.name + '」'
  );
}

function resolveHandSelection_(
  roomData,
  player,
  interaction,
  selection
) {
  const indexes =
    normalizeIndexes_(
      selection &&
      selection.handIndexes
    );

  const minimum =
    Number(interaction.min || 0);

  const maximum =
    Number(
      interaction.max == null
        ? player.state.hand.length
        : interaction.max
    );

  if (
    indexes.length < minimum ||
    indexes.length > maximum
  ) {
    throw new Error('選擇張數不符合限制。');
  }

  if (
    interaction.allowedType
  ) {
    indexes.forEach(function(index) {
      const card =
        getCardDefinition(
          player.state.hand[index]
        );

      if (
        !card ||
        !hasCardType_(
          card,
          interaction.allowedType
        )
      ) {
        throw new Error('選擇的卡片類型不符合限制。');
      }
    });
  }

  /*
   * V23.2.2：
   * 寶座廳必須在卡片仍位於手牌中時完成合法性驗證。
   * 舊版先 removeHandCards_，再用舊索引檢查手牌，
   * 會讓任何被選中的卡都被判定為不存在。
   */
  if (
    interaction.mode === 'repeatAction'
  ) {
    assertValidThroneRoomChoice_(
      roomData,
      player.id,
      indexes
    );
  }

  let destination = 'trash';

  if (interaction.mode === 'discardDraw') {
    destination = 'discard';
  } else if (interaction.mode === 'topDeck') {
    destination = 'topDeck';
  } else if (interaction.mode === 'repeatAction') {
    destination = 'play';
  }

  const selectedCards =
    removeHandCards_(
      player.state,
      indexes,
      destination
    );

  if (
    interaction.mode === 'discardDraw'
  ) {
    drawCards_(
      player.state,
      selectedCards.length
    );
  }

  if (
    interaction.mode === 'repeatAction'
  ) {
    if (selectedCards.length !== 1) {
      throw new Error('必須選擇一張行動卡。');
    }

    const repeatedCard =
      getCardDefinition(selectedCards[0]);

    if (
      !repeatedCard ||
      !hasCardType_(repeatedCard, 'action')
    ) {
      throw new Error('只能選擇行動卡。');
    }

    const playerIndex =
      roomData.players.findIndex(function(item) {
        return item.id === player.id;
      });

    const repeatCount =
      Math.max(
        1,
        Number(
          interaction.repeatCount || 2
        )
      );

    startThroneRepeat_(
      roomData,
      playerIndex,
      repeatedCard.id,
      repeatCount
    );

    addLog_(
      roomData,
      player.name,
      '透過「寶座廳」開始執行「' +
        repeatedCard.name +
        '」' +
        repeatCount +
        ' 次'
    );
  }

  if (
    interaction.mode === 'trashThenGain'
  ) {
    const trashedCard =
      getCardDefinition(selectedCards[0]);

    enqueueInteraction_(roomData, {
      type:'selectSupply',
      playerId:player.id,
      sourceCardId:
        interaction.sourceCardId,
      maxCost:
        trashedCard.cost +
        Number(interaction.costBonus || 0),
      allowedType:
        interaction.allowedType || '',
      destination:
        interaction.destination || 'discard'
    });
  }
}

function normalizeIndexes_(indexes) {
  return Array.from(
    new Set(
      (Array.isArray(indexes) ? indexes : [])
        .map(function(value) {
          return Number(value);
        })
        .filter(function(value) {
          return Number.isInteger(value);
        })
    )
  ).sort(function(a, b) {
    return b - a;
  });
}

function removeHandCards_(
  state,
  indexes,
  destination
) {
  const selected = [];

  indexes.forEach(function(index) {
    if (
      index < 0 ||
      index >= state.hand.length
    ) {
      throw new Error('手牌位置無效。');
    }

    const cardId =
      state.hand.splice(index, 1)[0];

    selected.push(cardId);

    if (destination === 'discard') {
      state.discard.push(cardId);
    } else if (destination === 'topDeck') {
      state.deck.unshift(cardId);
    } else if (destination === 'play') {
      state.play.push(cardId);
    }
  });

  return selected;
}

function assertCanAct_(roomData, playerId) {
  if (roomData.status !== '遊戲中') {
    throw new Error('遊戲尚未進行。');
  }

  if (getCurrentInteraction_(roomData)) {
    throw new Error('正在等待玩家處理卡片效果。');
  }

  if (roomData.phase !== 'action') {
    throw new Error('現在不是行動階段。');
  }

  const active =
    roomData.players[roomData.actionIndex];

  if (!active || active.id !== playerId) {
    throw new Error('現在不是你的行動順序。');
  }
}

function assertCanBuy_(roomData, playerId) {
  if (roomData.status !== '遊戲中') {
    throw new Error('遊戲尚未進行。');
  }

  if (getCurrentInteraction_(roomData)) {
    throw new Error('正在等待玩家處理卡片效果。');
  }

  if (roomData.phase !== 'buy') {
    throw new Error('現在不是購買階段。');
  }

  const player =
    findPlayer_(roomData, playerId);

  if (!player) {
    throw new Error('找不到玩家。');
  }

  if (player.buyFinished) {
    throw new Error('你已經完成購買。');
  }
}

function addLog_(
  roomData,
  playerName,
  text
) {
  roomData.log.push({
    playerName:playerName,
    text:text,
    time:new Date().toISOString()
  });

  if (roomData.log.length > 80) {
    roomData.log =
      roomData.log.slice(-80);
  }
}
