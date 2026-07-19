function applyCardEffects_(
  roomData,
  actorIndex,
  card
) {
  const actor =
    roomData.players[actorIndex];

  const result = {
    summary:[],
    interactionCreated:false
  };

  (card.effects || []).forEach(function(effect) {
    applySingleEffect_(
      roomData,
      actorIndex,
      effect,
      result
    );
  });

  return result;
}

function applySingleEffect_(
  roomData,
  actorIndex,
  effect,
  result
) {
  const actor =
    roomData.players[actorIndex];

  const amount =
    Math.max(0, Number(effect.amount || 0));

  switch (effect.type) {
    case 'draw':
      drawCards_(actor.state, amount);
      result.summary.push('抽 ' + amount + ' 張牌');
      break;

    case 'actions':
      actor.state.actions += amount;
      result.summary.push('+' + amount + ' 行動');
      break;

    case 'buys':
      actor.state.buys += amount;
      result.summary.push('+' + amount + ' 購買');
      break;

    case 'coins':
      actor.state.coins += amount;
      result.summary.push('+' + amount + ' 金錢');
      break;

    case 'allOpponentsDraw':
      getOpponentIndexes_(
        roomData,
        actorIndex
      ).forEach(function(index) {
        drawCards_(
          roomData.players[index].state,
          amount
        );
      });
      result.summary.push(
        '其他玩家各抽 ' + amount + ' 張牌'
      );
      break;

    case 'allOpponentsGain':
      getOpponentIndexes_(
        roomData,
        actorIndex
      ).forEach(function(index) {
        gainCard_(
          roomData,
          roomData.players[index].state,
          effect.cardId,
          effect.destination || 'discard'
        );
      });
      result.summary.push('其他玩家各獲得卡片');
      break;

    case 'attackAllOpponentsGain': {
      const gainCardId =
        effect.cardId;

      const gainCard =
        getCardDefinition(
          gainCardId
        );

      /*
       * V25.1.1：
       * 女巫的詛咒牌堆已空時，攻擊效果直接安全完成。
       * 不建立 reaction，也不讓 gainCard_ 拋出錯誤。
       */
      if (
        !gainCard ||
        Number(
          roomData.supply[gainCardId] || 0
        ) <= 0
      ) {
        result.summary.push(
          (
            gainCard
              ? '「' + gainCard.name + '」'
              : '目標卡片'
          ) +
          '牌堆已空，其他玩家未獲得卡片'
        );

        break;
      }

      let interactionCount = 0;
      let gainedCount = 0;

      getOpponentIndexes_(
        roomData,
        actorIndex
      ).forEach(function(index) {
        const outcome =
          enqueueGainAttackInteraction_(
            roomData,
            actorIndex,
            index,
            gainCardId,
            effect.destination || 'discard'
          );

        if (outcome === 'interaction') {
          interactionCount += 1;
        } else if (outcome === 'gained') {
          gainedCount += 1;
        }
      });

      result.interactionCreated =
        interactionCount > 0;

      if (interactionCount > 0) {
        result.summary.push(
          '等待其他玩家回應攻擊'
        );
      } else if (gainedCount > 0) {
        result.summary.push(
          '其他玩家各獲得卡片'
        );
      } else {
        result.summary.push(
          '牌堆已空，沒有玩家獲得卡片'
        );
      }

      break;
    }

    case 'allOpponentsDiscardTo': {
      let militiaInteractions = 0;
      const targetHandSize = Number(effect.handSize || 3);
      getOpponentIndexes_(roomData, actorIndex).forEach(function(index) {
        const opponent = roomData.players[index];
        const discardCount = opponent && opponent.state
          ? getSafeMilitiaDiscardCount_(opponent.state, targetHandSize)
          : 0;
        if (discardCount > 0) {
          enqueueMilitiaInteraction_(
            roomData,
            actorIndex,
            index,
            targetHandSize
          );
          militiaInteractions += 1;
        } else if (opponent) {
          addSafeComplete_(roomData, {
            cardId:'militia',
            playerId:opponent.id,
            reason:'手牌不超過 ' + targetHandSize + ' 張，不需要棄牌',
            context:'militia'
          });
        }
      });
      result.interactionCreated = militiaInteractions > 0;
      result.summary.push(
        militiaInteractions > 0
          ? '等待其他玩家處理攻擊'
          : '所有玩家手牌皆不需棄牌'
      );
      break;
    }

    case 'selectSupplyGain': {
      const maxCost = Number(effect.maxCost || 0);
      const sourceCardId = actor.state.play[actor.state.play.length - 1];
      if (!hasLegalSupplyChoice_(roomData, maxCost, '')) {
        addSafeComplete_(roomData, {
          cardId:sourceCardId,
          playerId:actor.id,
          reason:'供應區沒有費用 ' + maxCost + ' 以下的合法卡片',
          context:'selectSupplyGain'
        });
        result.summary.push('沒有合法可獲得卡片，效果結束');
      } else {
        enqueueInteraction_(roomData, {
          type:'selectSupply', playerId:actor.id,
          sourceCardId:sourceCardId,
          maxCost:maxCost,
          destination:effect.destination || 'discard'
        });
        result.interactionCreated = true;
      }
      break;
    }

    case 'selectHandTrash':
      enqueueInteraction_(roomData, {
        type:'selectHand',
        playerId:actor.id,
        sourceCardId:
          actor.state.play[
            actor.state.play.length - 1
          ],
        mode:'trash',
        min:Number(effect.min || 0),
        max:Number(effect.max || 0)
      });
      result.interactionCreated = true;
      break;

    case 'selectHandDiscardDraw':
      enqueueInteraction_(roomData, {
        type:'selectHand',
        playerId:actor.id,
        sourceCardId:
          actor.state.play[
            actor.state.play.length - 1
          ],
        mode:'discardDraw',
        min:Number(effect.min || 0),
        max:actor.state.hand.length
      });
      result.interactionCreated = true;
      break;

    case 'selectHandTrashThenGain': {
      const sourceCardId = actor.state.play[actor.state.play.length - 1];
      if (!actor.state.hand.length) {
        addSafeComplete_(roomData, {
          cardId:sourceCardId, playerId:actor.id,
          reason:'手牌為空，沒有可移除卡片', context:'trashThenGain'
        });
        result.summary.push('沒有可移除卡片，效果結束');
      } else {
        enqueueInteraction_(roomData, {
          type:'selectHand', playerId:actor.id,
          sourceCardId:sourceCardId, mode:'trashThenGain',
          min:1, max:1,
          costBonus:Number(effect.costBonus || 0),
          destination:effect.destination || 'discard'
        });
        result.interactionCreated = true;
      }
      break;
    }

    case 'selectTreasureTrashThenGain': {
      const sourceCardId = actor.state.play[actor.state.play.length - 1];
      const hasTreasure = actor.state.hand.some(function(cardId) {
        const card = getCardDefinition(cardId);
        return card && hasCardType_(card, 'treasure');
      });
      if (!hasTreasure) {
        addSafeComplete_(roomData, {
          cardId:sourceCardId, playerId:actor.id,
          reason:'手牌中沒有寶物', context:'mine'
        });
        result.summary.push('沒有寶物可升級，效果結束');
      } else {
        enqueueInteraction_(roomData, {
          type:'selectHand', playerId:actor.id,
          sourceCardId:sourceCardId, mode:'trashThenGain',
          min:1, max:1, allowedType:'treasure',
          costBonus:Number(effect.costBonus || 0),
          destination:effect.destination || 'hand'
        });
        result.interactionCreated = true;
      }
      break;
    }

    case 'discardDeck':
      actor.state.discard =
        actor.state.discard.concat(
          actor.state.deck
        );
      actor.state.deck = [];
      result.summary.push('牌庫全部放入棄牌堆');
      break;

    case 'trashSelfThenGain': {
      trashLastPlayedCard_(actor.state);
      const maxCost = Number(effect.maxCost || 5);
      if (!hasLegalSupplyChoice_(roomData, maxCost, '')) {
        addSafeComplete_(roomData, {
          cardId:'feast', playerId:actor.id,
          reason:'供應區沒有合法可獲得卡片', context:'feast'
        });
        result.summary.push('宴會廳已移除，但沒有合法卡片可獲得');
      } else {
        enqueueInteraction_(roomData, {
          type:'selectSupply', playerId:actor.id,
          sourceCardId:'feast', maxCost:maxCost,
          destination:effect.destination || 'discard'
        });
        result.interactionCreated = true;
      }
      break;
    }

    case 'drawUntilHand':
      startLibrarySequence_(
        roomData,
        actorIndex,
        Number(effect.handSize || 7)
      );

      if (getCurrentInteraction_(roomData)) {
        result.interactionCreated = true;
      }

      result.summary.push(
        '圖書館：抽牌直到手牌有 ' +
        Number(effect.handSize || 7) +
        ' 張'
      );
      break;

    case 'trashCopperForCoins':
      if (trashOneCardFromHand_(actor.state, 'copper')) {
        actor.state.coins +=
          Number(effect.amount || 3);
        result.summary.push('+3 金錢');
      }
      break;

    case 'adventurer':
      resolveAdventurer_(
        actor.state,
        Number(effect.treasureCount || 2)
      );
      result.summary.push('尋找兩張寶物牌');
      break;

    case 'bureaucrat':
      resolveBureaucrat_(
        roomData,
        actorIndex
      );
      result.summary.push('獲得銀幣到牌庫頂');
      break;

    case 'spyResolve':
      resolveSpy_(
        roomData,
        actorIndex
      );
      result.summary.push('查看各玩家牌庫頂');
      break;

    case 'thiefResolve':
      resolveThief_(
        roomData,
        actorIndex
      );
      result.summary.push('從其他玩家翻開的牌中取得寶物');
      break;

    case 'selectActionRepeat':
      const hasRepeatTarget =
        actor.state.hand.some(function(cardId) {
          const card =
            getCardDefinition(cardId);

          return (
            card &&
            hasCardType_(card, 'action')
          );
        });

      if (!hasRepeatTarget) {
        addLog_(
          roomData,
          actor.name,
          '「寶座廳」沒有其他可選的行動卡，效果自動略過'
        );

        result.summary.push(
          '沒有可重複的行動卡'
        );

        break;
      }

      enqueueInteraction_(roomData, {
        type:'selectHand',
        playerId:actor.id,
        sourceCardId:'throne_room',
        mode:'repeatAction',
        min:1,
        max:1,
        allowedType:'action',
        repeatCount:
          Number(effect.repeatCount || 2),
        allowCancel:true
      });

      result.interactionCreated = true;
      break;

    default:
      throw new Error(
        '尚未支援效果：' + effect.type
      );
  }
}

function getOpponentIndexes_(
  roomData,
  actorIndex
) {
  return roomData.players
    .map(function(player, index) {
      return index;
    })
    .filter(function(index) {
      return index !== actorIndex;
    });
}


function enqueueGainAttackInteraction_(
  roomData,
  attackerIndex,
  defenderIndex,
  cardId,
  destination
) {
  const defender =
    roomData.players[defenderIndex];

  if (
    !defender ||
    !defender.state
  ) {
    return 'skipped';
  }

  /*
   * 多人遊戲中，牌堆可能在前一位玩家取得卡片後歸零。
   * 後面的玩家直接略過，不視為錯誤。
   */
  if (
    Number(
      roomData.supply[cardId] || 0
    ) <= 0
  ) {
    return 'skipped';
  }

  const hasMoat =
    defender.state.hand
      .indexOf('moat') !== -1;

  if (hasMoat) {
    enqueueInteraction_(roomData, {
      type:'reaction',
      attackType:'gainCard',
      sourceCardId:'witch',
      attackerId:
        roomData.players[attackerIndex].id,
      defenderId:defender.id,
      playerId:defender.id,
      cardId:cardId,
      destination:
        destination || 'discard',
      canRevealMoat:true
    });

    return 'interaction';
  }

  const gained =
    tryGainCard_(
      roomData,
      defender.state,
      cardId,
      destination || 'discard'
    );

  return gained
    ? 'gained'
    : 'skipped';
}


function enqueueMilitiaInteraction_(
  roomData,
  attackerIndex,
  defenderIndex,
  targetHandSize
) {
  const defender =
    roomData.players[defenderIndex];

  if (
    defender.state.hand.length <=
    targetHandSize
  ) {
    return;
  }

  const hasMoat =
    defender.state.hand.indexOf('moat') !== -1;

  enqueueInteraction_(roomData, {
    type:hasMoat ? 'reaction' : 'discard',
    attackType:'discardTo',
    sourceCardId:'militia',
    attackerId:
      roomData.players[attackerIndex].id,
    defenderId:defender.id,
    playerId:defender.id,
    targetHandSize:targetHandSize,
    requiredDiscardCount:
      defender.state.hand.length -
      targetHandSize,
    canRevealMoat:hasMoat
  });
}


function isInteractionType_(interaction, type) {
  return Boolean(
    interaction &&
    interaction.type === type
  );
}

function isEffectFrameType_(frame, type) {
  return Boolean(
    frame &&
    frame.type === type
  );
}

function ensureEngineEvents_(roomData) {
  if (!Array.isArray(roomData.engineEvents)) {
    roomData.engineEvents = [];
  }

  return roomData.engineEvents;
}

function addEngineEvent_(
  roomData,
  eventType,
  details
) {
  const events =
    ensureEngineEvents_(roomData);

  roomData.engineEventSequence =
    Number(
      roomData.engineEventSequence || 0
    ) + 1;

  events.push({
    sequence:roomData.engineEventSequence,
    eventType:String(eventType || 'engine'),
    createdAt:new Date().toISOString(),
    interactionId:
      details && details.interactionId
        ? details.interactionId
        : '',
    frameId:
      details && details.frameId
        ? details.frameId
        : '',
    cardId:
      details && details.cardId
        ? details.cardId
        : '',
    playerId:
      details && details.playerId
        ? details.playerId
        : '',
    message:
      details && details.message
        ? String(details.message)
        : ''
  });

  if (events.length > 120) {
    events.splice(
      0,
      events.length - 120
    );
  }
}


function ensureSafeCompleteLog_(roomData) {
  if (!Array.isArray(roomData.safeCompleteLog)) {
    roomData.safeCompleteLog = [];
  }
  return roomData.safeCompleteLog;
}

function addSafeComplete_(roomData, details) {
  const entry = {
    createdAt:new Date().toISOString(),
    cardId:details && details.cardId ? details.cardId : '',
    playerId:details && details.playerId ? details.playerId : '',
    interactionId:details && details.interactionId ? details.interactionId : '',
    frameId:details && details.frameId ? details.frameId : '',
    reason:details && details.reason ? String(details.reason) : '沒有合法目標',
    context:details && details.context ? String(details.context) : ''
  };
  const log = ensureSafeCompleteLog_(roomData);
  log.push(entry);
  if (log.length > 80) log.splice(0, log.length - 80);
  addEngineEvent_(roomData, 'SAFE_COMPLETE', {
    cardId:entry.cardId,
    playerId:entry.playerId,
    interactionId:entry.interactionId,
    frameId:entry.frameId,
    message:entry.reason + (entry.context ? '｜' + entry.context : '')
  });
  return entry;
}

function initializeInteractionWatchdog_(interaction) {
  if (!interaction) return interaction;
  interaction.createdAt = interaction.createdAt || new Date().toISOString();
  interaction.updatedAt = interaction.updatedAt || interaction.createdAt;
  interaction.watchdogCount = Number(interaction.watchdogCount || 0);
  return interaction;
}

function safeCompleteInteraction_(roomData, interaction, reason) {
  if (!interaction) return false;
  addSafeComplete_(roomData, {
    cardId:interaction.sourceCardId || '',
    playerId:interaction.playerId || '',
    interactionId:interaction.interactionId || '',
    reason:reason || '互動無法繼續',
    context:interaction.type || ''
  });
  completeCurrentInteraction_(roomData);
  runEffectEngine_(roomData, 'safe-complete-interaction');
  return true;
}

function hasLegalSupplyChoice_(roomData, maxCost, allowedType) {
  return Object.keys(roomData.supply || {}).some(function(cardId) {
    const card = getCardDefinition(cardId);
    return Boolean(
      card &&
      Number(roomData.supply[cardId] || 0) > 0 &&
      Number(card.cost || 0) <= Number(maxCost || 0) &&
      (!allowedType || hasCardType_(card, allowedType))
    );
  });
}

function getSafeMilitiaDiscardCount_(state, handSize) {
  const count = state && Array.isArray(state.hand) ? state.hand.length : 0;
  return Math.max(0, count - Number(handSize || 3));
}

function ensureRoomHealth_(roomData) {
  if (!roomData.roomHealth) {
    roomData.roomHealth = {
      status:'healthy',
      lastCheckedAt:'',
      lastRepairAt:'',
      lastRepairType:'',
      lastRepairMessage:'',
      repairCount:0,
      dataSizeBytes:0
    };
  }
  return roomData.roomHealth;
}

function estimateRoomDataSize_(roomData) {
  try {
    return JSON.stringify(roomData).length;
  } catch (error) {
    return 0;
  }
}

function cleanupCompletedEngineState_(roomData) {
  if (!roomData) return;

  if (Array.isArray(roomData.effectStack)) {
    roomData.effectStack =
      roomData.effectStack.filter(function(frame) {
        return Boolean(
          frame &&
          frame.status !== 'done' &&
          frame.status !== 'completed' &&
          frame.status !== 'cancelled'
        );
      });
  }

  if (Array.isArray(roomData.attackSequences)) {
    roomData.attackSequences =
      roomData.attackSequences.filter(function(sequence) {
        return Boolean(
          sequence &&
          sequence.status !== 'done' &&
          sequence.status !== 'completed' &&
          sequence.status !== 'cancelled'
        );
      });
  }

  if (Array.isArray(roomData.interactionQueue)) {
    roomData.interactionQueue =
      roomData.interactionQueue.filter(function(interaction) {
        return Boolean(
          interaction &&
          interaction.status !== 'done' &&
          interaction.status !== 'completed' &&
          interaction.status !== 'cancelled'
        );
      });
  }

  if (Array.isArray(roomData.engineEvents)) {
    roomData.engineEvents =
      roomData.engineEvents.slice(-80);
  }

  if (Array.isArray(roomData.log)) {
    roomData.log =
      roomData.log.slice(-80);
  }
}

function getRoomHealthSnapshot_(roomData) {
  const health =
    ensureRoomHealth_(roomData);

  const interaction =
    getCurrentInteraction_(roomData);

  const effectDepth =
    Array.isArray(roomData.effectStack)
      ? roomData.effectStack.length
      : 0;

  const attackDepth =
    Array.isArray(roomData.attackSequences)
      ? roomData.attackSequences.length
      : 0;

  const interactionDepth =
    Array.isArray(roomData.interactionQueue)
      ? roomData.interactionQueue.length
      : 0;

  health.lastCheckedAt =
    new Date().toISOString();

  health.dataSizeBytes =
    estimateRoomDataSize_(roomData);

  if (
    interactionDepth === 0 &&
    effectDepth === 0 &&
    attackDepth === 0
  ) {
    health.status = 'healthy';
  } else if (
    health.status !== 'repaired'
  ) {
    health.status = 'busy';
  }

  return {
    status:health.status,
    actionablePlayers:
      Array.isArray(roomData.players)
        ? roomData.players.filter(function(player) {
            return Boolean(
              player &&
              player.active !== false &&
              player.connected !== false
            );
          }).length
        : 0,
    interactionDepth:interactionDepth,
    effectDepth:effectDepth,
    attackDepth:attackDepth,
    currentInteraction:
      interaction
        ? {
            interactionId:
              interaction.interactionId || '',
            type:
              interaction.type || '',
            playerId:
              interaction.playerId || ''
          }
        : null,
    lastCheckedAt:
      health.lastCheckedAt || '',
    lastRepairAt:
      health.lastRepairAt || '',
    lastRepairType:
      health.lastRepairType || '',
    lastRepairMessage:
      health.lastRepairMessage || '',
    repairCount:
      Number(health.repairCount || 0),
    dataSizeBytes:
      Number(health.dataSizeBytes || 0)
  };
}

function recordRoomRepair_(
  roomData,
  type,
  message
) {
  const health =
    ensureRoomHealth_(roomData);

  health.status = 'repaired';
  health.lastRepairAt =
    new Date().toISOString();
  health.lastRepairType =
    String(type || 'repair');
  health.lastRepairMessage =
    String(message || '');
  health.repairCount =
    Number(health.repairCount || 0) + 1;

  addEngineEvent_(
    roomData,
    'ROOM_REPAIR',
    {
      message:
        health.lastRepairType +
        '：' +
        health.lastRepairMessage
    }
  );
}

function repairRoomState_(
  roomData,
  reason
) {
  cleanupCompletedEngineState_(
    roomData
  );

  let repaired = false;
  const notes = [];

  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    initializeInteractionWatchdog_(interaction);
    interaction.watchdogCount =
      Number(interaction.watchdogCount || 0) + 1;

    const target =
      findPlayer_(
        roomData,
        interaction.playerId
      );

    if (!target) {
      completeCurrentInteraction_(
        roomData
      );
      notes.push(
        '移除找不到玩家的互動'
      );
      repaired = true;
    } else if (
      Number(interaction.watchdogCount || 0) >= 6
    ) {
      safeCompleteInteraction_(
        roomData,
        interaction,
        '互動連續多次同步沒有進展'
      );
      notes.push('Safe Complete 長時間無進展互動');
      repaired = true;
    }
  }

  if (
    !getCurrentInteraction_(roomData) &&
    Array.isArray(roomData.attackSequences) &&
    roomData.attackSequences.length > 0
  ) {
    continueAttackEngineIfNeeded_(
      roomData
    );
    notes.push(
      '推進孤立的 Attack Sequence'
    );
    repaired = true;
  }

  if (
    !getCurrentInteraction_(roomData) &&
    Array.isArray(roomData.effectStack) &&
    roomData.effectStack.length > 0
  ) {
    resumeEffectStack_(roomData);
    notes.push(
      '推進孤立的 Effect Stack'
    );
    repaired = true;
  }

  cleanupCompletedEngineState_(
    roomData
  );

  if (repaired) {
    recordRoomRepair_(
      roomData,
      reason || 'automatic',
      notes.join('；')
    );
  }

  return {
    repaired:repaired,
    notes:notes,
    health:getRoomHealthSnapshot_(
      roomData
    )
  };
}

function runEffectEngine_(
  roomData,
  reason
) {
  cleanupCompletedEngineState_(roomData);
  const beforeDepth =
    Array.isArray(roomData.effectStack)
      ? roomData.effectStack.length
      : 0;

  continueAttackEngineIfNeeded_(
    roomData
  );

  addEngineEvent_(
    roomData,
    'ENGINE_RESUME',
    {
      frameId:
        peekEffectFrame_(roomData)
          ? (
              peekEffectFrame_(roomData)
                .frameId || ''
            )
          : '',
      message:String(reason || 'resume')
    }
  );

  resumeEffectStack_(roomData);

  roomData.engineVersion =
    Number(
      roomData.engineVersion || 0
    ) + 1;

  const interaction =
    getCurrentInteraction_(roomData);

  if (
    !interaction &&
    Array.isArray(roomData.effectStack) &&
    roomData.effectStack.length > 0
  ) {
    addEngineEvent_(
      roomData,
      'ENGINE_PENDING_STACK',
      {
        frameId:
          peekEffectFrame_(roomData)
            ? (
                peekEffectFrame_(roomData)
                  .frameId || ''
              )
            : '',
        message:
          '沒有 interaction，但仍有 ' +
          roomData.effectStack.length +
          ' 層效果'
      }
    );
  }

  addEngineEvent_(
    roomData,
    'ENGINE_STABLE',
    {
      interactionId:
        interaction
          ? (
              interaction.interactionId || ''
            )
          : '',
      frameId:
        peekEffectFrame_(roomData)
          ? (
              peekEffectFrame_(roomData)
                .frameId || ''
            )
          : '',
      message:
        'depth ' +
        beforeDepth +
        ' → ' +
        (
          Array.isArray(roomData.effectStack)
            ? roomData.effectStack.length
            : 0
        )
    }
  );

  return interaction;
}

function finalizeInteraction_(
  roomData,
  interaction,
  reason
) {
  addEngineEvent_(
    roomData,
    'INTERACTION_COMPLETE',
    {
      interactionId:
        interaction
          ? (
              interaction.interactionId || ''
            )
          : '',
      cardId:
        interaction
          ? (
              interaction.sourceCardId || ''
            )
          : '',
      playerId:
        interaction
          ? (
              interaction.playerId || ''
            )
          : '',
      message:String(reason || 'complete')
    }
  );

  completeCurrentInteraction_(roomData);

  return runEffectEngine_(
    roomData,
    reason || 'interaction-complete'
  );
}


function ensureAttackSequences_(
  roomData
) {
  if (!Array.isArray(roomData.attackSequences)) {
    roomData.attackSequences = [];
  }

  return roomData.attackSequences;
}

function pushAttackSequence_(
  roomData,
  sequence
) {
  roomData.attackSequenceCounter =
    Number(
      roomData.attackSequenceCounter || 0
    ) + 1;

  sequence.attackSequenceId =
    sequence.attackSequenceId ||
    (
      'atk_' +
      roomData.attackSequenceCounter +
      '_' +
      new Date().getTime()
    );

  sequence.currentTargetIndex =
    Number(
      sequence.currentTargetIndex || 0
    );

  sequence.status =
    sequence.status || 'running';

  sequence.createdAt =
    sequence.createdAt ||
    new Date().toISOString();

  ensureAttackSequences_(roomData)
    .push(sequence);

  addEngineEvent_(
    roomData,
    'ATTACK_SEQUENCE_PUSH',
    {
      cardId:
        sequence.sourceCardId || '',
      playerId:
        sequence.attackerId || '',
      message:
        sequence.attackSequenceId
    }
  );

  return sequence;
}

function peekAttackSequence_(
  roomData
) {
  const list =
    ensureAttackSequences_(roomData);

  return list.length
    ? list[list.length - 1]
    : null;
}

function popAttackSequence_(
  roomData
) {
  const list =
    ensureAttackSequences_(roomData);

  const sequence =
    list.length
      ? list.pop()
      : null;

  if (sequence) {
    addEngineEvent_(
      roomData,
      'ATTACK_SEQUENCE_POP',
      {
        cardId:
          sequence.sourceCardId || '',
        playerId:
          sequence.attackerId || '',
        message:
          sequence.attackSequenceId || ''
      }
    );
  }

  return sequence;
}

function getAttackTargetPlayer_(
  roomData,
  sequence
) {
  if (!sequence) return null;

  const targetId =
    (
      sequence.targetPlayerIds || []
    )[
      Number(
        sequence.currentTargetIndex || 0
      )
    ];

  return targetId
    ? findPlayer_(
        roomData,
        targetId
      )
    : null;
}

function attackTargetHasMoat_(
  target
) {
  return Boolean(
    target &&
    target.state &&
    target.state.hand &&
    target.state.hand.indexOf('moat') !== -1
  );
}

function queueAttackReaction_(
  roomData,
  sequence,
  target
) {
  sequence.status =
    'waiting-reaction';

  sequence.updatedAt =
    new Date().toISOString();

  enqueueInteraction_(
    roomData,
    {
      type:'reaction',
      playerId:target.id,
      sourceCardId:
        sequence.sourceCardId,
      attackType:
        sequence.attackType,
      attackerId:
        sequence.attackerId,
      defenderId:
        target.id,
      attackSequenceId:
        sequence.attackSequenceId,
      cardId:
        sequence.cardId || '',
      destination:
        sequence.destination || '',
      requiredDiscardCount:
        sequence.requiredDiscardCount || 0,
      canRevealMoat:true,
      allowCancel:false
    }
  );
}

function completeAttackTarget_(
  roomData,
  sequence,
  outcome
) {
  addEngineEvent_(
    roomData,
    'ATTACK_TARGET_COMPLETE',
    {
      cardId:
        sequence
          ? sequence.sourceCardId || ''
          : '',
      playerId:
        getAttackTargetPlayer_(
          roomData,
          sequence
        )
          ? getAttackTargetPlayer_(
              roomData,
              sequence
            ).id
          : '',
      message:
        String(outcome || 'complete')
    }
  );

  sequence.currentTargetIndex += 1;
  sequence.status = 'running';
  sequence.updatedAt =
    new Date().toISOString();
}

function continueAttackSequence_(
  roomData,
  sequence
) {
  if (
    !sequence ||
    getCurrentInteraction_(roomData)
  ) {
    return;
  }

  const targets =
    sequence.targetPlayerIds || [];

  if (
    sequence.currentTargetIndex >=
      targets.length
  ) {
    sequence.status = 'done';
    popAttackSequence_(roomData);
    runEffectEngine_(
      roomData,
      'attack-sequence-complete'
    );
    return;
  }

  const target =
    getAttackTargetPlayer_(
      roomData,
      sequence
    );

  if (
    !target ||
    !target.state
  ) {
    completeAttackTarget_(
      roomData,
      sequence,
      'target-missing'
    );

    continueAttackSequence_(
      roomData,
      sequence
    );
    return;
  }

  if (
    attackTargetHasMoat_(target)
  ) {
    queueAttackReaction_(
      roomData,
      sequence,
      target
    );
    return;
  }

  executeAttackAgainstTarget_(
    roomData,
    sequence,
    target
  );
}

function executeAttackAgainstTarget_(
  roomData,
  sequence,
  target
) {
  if (!sequence || !target) return;

  sequence.status =
    'resolving-target';

  sequence.updatedAt =
    new Date().toISOString();

  if (
    sequence.attackType ===
      'discardTo'
  ) {
    enqueueInteraction_(
      roomData,
      {
        type:'discard',
        playerId:target.id,
        sourceCardId:
          sequence.sourceCardId,
        requiredDiscardCount:
          Math.max(
            0,
            Number(
              sequence.requiredDiscardCount ||
              0
            )
          ),
        attackSequenceId:
          sequence.attackSequenceId,
        allowCancel:false
      }
    );
    return;
  }

  if (
    sequence.attackType ===
      'bureaucratVictory'
  ) {
    enqueueBureaucratVictory_(
      roomData,
      target
    );
    return;
  }

  if (
    sequence.attackType ===
      'spyReveal'
  ) {
    const attacker =
      findPlayer_(
        roomData,
        sequence.attackerId
      );

    if (attacker) {
      enqueueSpyDecisionForTarget_(
        roomData,
        attacker,
        target
      );
    }

    return;
  }

  if (
    sequence.attackType ===
      'thiefReveal'
  ) {
    const attacker =
      findPlayer_(
        roomData,
        sequence.attackerId
      );

    if (attacker) {
      enqueueThiefReveal_(
        roomData,
        attacker,
        target
      );
    }

    return;
  }

  if (
    sequence.attackType ===
      'gainCard'
  ) {
    const gained =
      tryGainCard_(
        roomData,
        target.state,
        sequence.cardId,
        sequence.destination || 'discard'
      );

    completeAttackTarget_(
      roomData,
      sequence,
      gained
        ? 'gain-card'
        : 'gain-pile-empty'
    );

    continueAttackSequence_(
      roomData,
      sequence
    );
    return;
  }

  completeAttackTarget_(
    roomData,
    sequence,
    'unknown-attack-skipped'
  );

  continueAttackSequence_(
    roomData,
    sequence
  );
}

function resolveAttackReaction_(
  roomData,
  interaction,
  revealMoat
) {
  const sequence =
    (
      ensureAttackSequences_(roomData)
    ).find(function(item) {
      return (
        item.attackSequenceId ===
        interaction.attackSequenceId
      );
    }) ||
    peekAttackSequence_(roomData);

  const target =
    findPlayer_(
      roomData,
      interaction.playerId
    );

  if (!sequence || !target) {
    finalizeInteraction_(
      roomData,
      interaction,
      'reaction-without-sequence'
    );
    return;
  }

  if (revealMoat) {
    addLog_(
      roomData,
      target.name,
      '展示「護城河」，免疫「' +
        (
          getCardDefinition(
            sequence.sourceCardId
          )
            ? getCardDefinition(
                sequence.sourceCardId
              ).name
            : '攻擊'
        ) +
        '」'
    );

    completeCurrentInteraction_(
      roomData
    );

    completeAttackTarget_(
      roomData,
      sequence,
      'moat-revealed'
    );

    continueAttackSequence_(
      roomData,
      sequence
    );

    return;
  }

  completeCurrentInteraction_(
    roomData
  );

  executeAttackAgainstTarget_(
    roomData,
    sequence,
    target
  );
}

function continueAttackEngineIfNeeded_(
  roomData
) {
  if (getCurrentInteraction_(roomData)) {
    return;
  }

  const sequence =
    peekAttackSequence_(roomData);

  if (sequence) {
    continueAttackSequence_(
      roomData,
      sequence
    );
  }
}

function enqueueInteraction_(
  roomData,
  interaction
) {
  if (!Array.isArray(roomData.interactionQueue)) {
    roomData.interactionQueue = [];
  }

  if (
    interaction.allowCancel == null
  ) {
    interaction.allowCancel =
      interaction.type === 'selectHand' ||
      interaction.type === 'selectSupply';
  }

  roomData.interactionSequence =
    Number(roomData.interactionSequence || 0) + 1;

  interaction.interactionId =
    interaction.interactionId ||
    (
      'ix_' +
      roomData.interactionSequence +
      '_' +
      new Date().getTime()
    );

  interaction.sequence =
    roomData.interactionSequence;
  interaction.createdAt =
    interaction.createdAt ||
    new Date().toISOString();
  interaction.status =
    interaction.status || 'waiting';

  initializeInteractionWatchdog_(interaction);

  roomData.interactionQueue.push(interaction);

  addEngineEvent_(
    roomData,
    'INTERACTION_ENQUEUE',
    {
      interactionId:
        interaction.interactionId || '',
      cardId:
        interaction.sourceCardId || '',
      playerId:
        interaction.playerId || '',
      message:
        interaction.type || ''
    }
  );
}

function getCurrentInteraction_(roomData) {
  return (
    Array.isArray(roomData.interactionQueue) &&
    roomData.interactionQueue.length > 0
  )
    ? roomData.interactionQueue[0]
    : null;
}

function completeCurrentInteraction_(roomData) {
  if (
    Array.isArray(roomData.interactionQueue) &&
    roomData.interactionQueue.length > 0
  ) {
    const completed =
      roomData.interactionQueue.shift();

    if (!Array.isArray(roomData.interactionHistory)) {
      roomData.interactionHistory = [];
    }

    if (completed) {
      completed.status = 'completed';
      completed.completedAt =
        new Date().toISOString();

      roomData.interactionHistory.push({
        interactionId:completed.interactionId || '',
        type:completed.type || '',
        playerId:completed.playerId || '',
        sourceCardId:completed.sourceCardId || '',
        completedAt:completed.completedAt
      });

      if (roomData.interactionHistory.length > 50) {
        roomData.interactionHistory.splice(
          0,
          roomData.interactionHistory.length - 50
        );
      }
    }
  }
}


function tryGainCard_(
  roomData,
  playerState,
  cardId,
  destination
) {
  const card =
    getCardDefinition(cardId);

  if (
    !card ||
    Number(
      roomData.supply[cardId] || 0
    ) <= 0
  ) {
    return false;
  }

  roomData.supply[cardId] -= 1;

  if (destination === 'hand') {
    playerState.hand.push(cardId);
  } else if (
    destination === 'deckTop'
  ) {
    playerState.deck.unshift(cardId);
  } else {
    playerState.discard.push(cardId);
  }

  return true;
}

function gainCard_(
  roomData,
  playerState,
  cardId,
  destination
) {
  if (
    !tryGainCard_(
      roomData,
      playerState,
      cardId,
      destination
    )
  ) {
    throw new Error(
      '該牌堆已經空了。'
    );
  }
}


function trashLastPlayedCard_(state) {
  if (!Array.isArray(state.play)) return '';

  const index =
    state.play.length - 1;

  if (index < 0) return '';

  return state.play.splice(index, 1)[0];
}

function trashOneCardFromHand_(
  state,
  cardId
) {
  const index =
    state.hand.indexOf(cardId);

  if (index === -1) {
    return false;
  }

  state.hand.splice(index, 1);
  return true;
}

function drawUntilHandSize_(
  state,
  targetSize
) {
  while (
    state.hand.length < targetSize
  ) {
    const before =
      state.hand.length;

    drawCards_(state, 1);

    if (state.hand.length === before) {
      break;
    }
  }
}

function revealTopCards_(
  state,
  count
) {
  const revealed = [];

  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) {
        break;
      }

      state.deck =
        shuffleArray_(state.discard);

      state.discard = [];
    }

    revealed.push(
      state.deck.shift()
    );
  }

  return revealed;
}

function resolveAdventurer_(
  state,
  treasureTarget
) {
  const treasures = [];
  const others = [];

  while (
    treasures.length < treasureTarget
  ) {
    const revealed =
      revealTopCards_(state, 1);

    if (!revealed.length) {
      break;
    }

    const cardId = revealed[0];
    const card =
      getCardDefinition(cardId);

    if (
      card &&
      hasCardType_(card, 'treasure')
    ) {
      treasures.push(cardId);
    } else {
      others.push(cardId);
    }
  }

  state.hand =
    state.hand.concat(treasures);

  state.discard =
    state.discard.concat(others);
}

function resolveBureaucrat_(
  roomData,
  actorIndex
) {
  const actor =
    roomData.players[actorIndex];

  if (
    Number(
      roomData.supply.silver || 0
    ) > 0
  ) {
    gainCard_(
      roomData,
      actor.state,
      'silver',
      'deckTop'
    );

    addLog_(
      roomData,
      actor.name,
      '透過「官員」獲得一張銀幣到牌庫頂'
    );
  } else {
    addLog_(
      roomData,
      actor.name,
      '銀幣牌堆已空，官員沒有獲得銀幣'
    );
  }

  getOpponentIndexes_(
    roomData,
    actorIndex
  ).forEach(function(index) {
    const opponent =
      roomData.players[index];

    const hasMoat =
      opponent.state.hand
        .indexOf('moat') !== -1;

    if (hasMoat) {
      enqueueInteraction_(
        roomData,
        {
          type:'reaction',
          attackType:
            'bureaucratVictory',
          sourceCardId:'bureaucrat',
          attackerId:actor.id,
          defenderId:opponent.id,
          playerId:opponent.id,
          canRevealMoat:true
        }
      );

      return;
    }

    enqueueBureaucratVictory_(
      roomData,
      opponent
    );
  });
}

function enqueueBureaucratVictory_(
  roomData,
  opponent
) {
  const victoryIndexes =
    opponent.state.hand
      .map(function(cardId, index) {
        const card =
          getCardDefinition(cardId);

        return (
          card &&
          hasCardType_(card, 'victory')
        )
          ? index
          : -1;
      })
      .filter(function(index) {
        return index >= 0;
      });

  if (!victoryIndexes.length) {
    const names =
      opponent.state.hand.map(
        function(cardId) {
          const card =
            getCardDefinition(cardId);

          return card
            ? card.name
            : cardId;
        }
      );

    addLog_(
      roomData,
      opponent.name,
      '因「官員」展示手牌：' +
        (
          names.length
            ? names.join('、')
            : '沒有手牌'
        ) +
        '（沒有勝利卡）'
    );

    return;
  }

  enqueueInteraction_(
    roomData,
    {
      type:'selectHand',
      playerId:opponent.id,
      sourceCardId:'bureaucrat',
      mode:'topDeck',
      min:1,
      max:1,
      allowedType:'victory',
      allowCancel:false
    }
  );
}


function ensureEffectStack_(roomData) {
  if (!Array.isArray(roomData.effectStack)) {
    roomData.effectStack = [];
  }

  return roomData.effectStack;
}

function pushEffectFrame_(roomData, frame) {
  roomData.effectFrameSequence =
    Number(
      roomData.effectFrameSequence || 0
    ) + 1;

  const stack =
    ensureEffectStack_(roomData);

  frame.frameId =
    frame.frameId ||
    (
      'fx_' +
      roomData.effectFrameSequence +
      '_' +
      new Date().getTime()
    );

  frame.parentFrameId =
    frame.parentFrameId ||
    (
      stack.length
        ? (
            stack[stack.length - 1]
              .frameId || ''
          )
        : ''
    );

  frame.createdAt =
    frame.createdAt ||
    new Date().toISOString();

  stack.push(frame);

  roomData.effectStackVersion =
    Number(roomData.effectStackVersion || 0) + 1;
}

function peekEffectFrame_(roomData) {
  const stack =
    ensureEffectStack_(roomData);

  return stack.length
    ? stack[stack.length - 1]
    : null;
}

function popEffectFrame_(roomData) {
  const stack =
    ensureEffectStack_(roomData);

  const popped =
    stack.length
      ? stack.pop()
      : null;

  if (popped) {
    roomData.effectStackVersion =
      Number(roomData.effectStackVersion || 0) + 1;
  }

  return popped;
}

function resumeEffectStack_(roomData) {
  let safety = 0;

  while (
    !getCurrentInteraction_(roomData) &&
    peekEffectFrame_(roomData) &&
    safety < 200
  ) {
    safety += 1;

    const beforeFrame =
      peekEffectFrame_(roomData);

    if (beforeFrame) {
      beforeFrame.status = 'running';
      beforeFrame.updatedAt =
        new Date().toISOString();
    }

    const beforeId =
      beforeFrame
        ? (
            beforeFrame.frameId ||
            ''
          )
        : '';

    const beforeLength =
      ensureEffectStack_(roomData)
        .length;

    if (isEffectFrameType_(beforeFrame, 'spySequence')) {
      continueSpySequence_(
        roomData,
        beforeFrame
      );
    } else if (
      isEffectFrameType_(beforeFrame, 'throneRepeat')
    ) {
      continueThroneRepeat_(
        roomData,
        beforeFrame
      );
    } else if (
      isEffectFrameType_(beforeFrame, 'librarySequence')
    ) {
      continueLibrarySequence_(
        roomData,
        beforeFrame
      );
    } else {
      popEffectFrame_(roomData);
    }

    if (getCurrentInteraction_(roomData)) {
      return;
    }

    const afterFrame =
      peekEffectFrame_(roomData);

    const afterId =
      afterFrame
        ? (
            afterFrame.frameId ||
            ''
          )
        : '';

    const afterLength =
      ensureEffectStack_(roomData)
        .length;

    /*
     * 若執行後堆疊完全沒有變化，避免無限迴圈。
     */
    if (
      beforeLength === afterLength &&
      beforeId === afterId
    ) {
      return;
    }
  }

  if (safety >= 200) {
    throw new Error(
      '卡片效果堆疊超過安全處理上限。'
    );
  }
}

function startSpySequence_(
  roomData,
  actorIndex
) {
  const actor =
    roomData.players[actorIndex];

  const targets =
    roomData.players
      .map(function(player) {
        return player.id;
      });

  pushEffectFrame_(
    roomData,
    {
      type:'spySequence',
      actorId:actor.id,
      targetPlayerIds:targets,
      targetIndex:0
    }
  );

  continueSpySequence_(
    roomData,
    peekEffectFrame_(roomData)
  );
}

function continueSpySequence_(
  roomData,
  frame
) {
  const actor =
    findPlayer_(
      roomData,
      frame.actorId
    );

  if (!actor) {
    popEffectFrame_(roomData);
    return;
  }

  while (
    frame.targetIndex <
    frame.targetPlayerIds.length
  ) {
    const targetId =
      frame.targetPlayerIds[
        frame.targetIndex
      ];

    frame.targetIndex += 1;

    const target =
      findPlayer_(
        roomData,
        targetId
      );

    if (!target || !target.state) {
      continue;
    }

    if (
      target.id !== actor.id &&
      target.state.hand
        .indexOf('moat') !== -1
    ) {
      enqueueInteraction_(
        roomData,
        {
          type:'reaction',
          attackType:'spyReveal',
          sourceCardId:'spy',
          attackerId:actor.id,
          defenderId:target.id,
          playerId:target.id,
          canRevealMoat:true
        }
      );

      return;
    }

    enqueueSpyDecisionForTarget_(
      roomData,
      actor,
      target
    );

    if (getCurrentInteraction_(roomData)) {
      return;
    }
  }

  popEffectFrame_(roomData);
  resumeEffectStack_(roomData);
}

function enqueueSpyDecisionForTarget_(
  roomData,
  actor,
  target
) {
  const revealed =
    revealTopCards_(
      target.state,
      1
    );

  if (!revealed.length) {
    addLog_(
      roomData,
      actor.name,
      target.name +
        ' 沒有牌可供間諜查看'
    );
    return;
  }

  enqueueInteraction_(
    roomData,
    {
      type:'spyDecision',
      playerId:actor.id,
      sourceCardId:'spy',
      targetPlayerId:target.id,
      targetPlayerName:target.name,
      targetIsActor:
        target.id === actor.id,
      revealedCardId:revealed[0],
      allowCancel:false
    }
  );
}

function startLibrarySequence_(
  roomData,
  actorIndex,
  targetSize
) {
  const actor =
    roomData.players[actorIndex];

  actor.state.librarySetAside = [];

  pushEffectFrame_(
    roomData,
    {
      type:'librarySequence',
      actorId:actor.id,
      targetHandSize:
        Number(targetSize || 7)
    }
  );

  continueLibrarySequence_(
    roomData,
    peekEffectFrame_(roomData)
  );
}

function continueLibrarySequence_(
  roomData,
  frame
) {
  const actor =
    findPlayer_(
      roomData,
      frame.actorId
    );

  if (!actor || !actor.state) {
    popEffectFrame_(roomData);
    resumeEffectStack_(roomData);
    return;
  }

  /*
   * V23.0.4：
   * 圖書館必須在同一次伺服器處理中，持續翻牌直到：
   * 1. 手牌到 7 張；
   * 2. 翻到行動卡，需要真人決定；
   * 3. 牌庫與棄牌堆都沒有牌。
   *
   * 舊版每次只翻一張非行動卡便返回，因此：
   * 寶座廳 → 寶座廳 → 圖書館
   * 會留下 effectStack，但畫面沒有互動，看起來像卡住。
   */
  let safety = 0;

  while (
    actor.state.hand.length <
      frame.targetHandSize &&
    safety < 200
  ) {
    safety += 1;

    const revealed =
      revealTopCards_(
        actor.state,
        1
      );

    if (!revealed.length) {
      finishLibraryEffect_(
        roomData,
        actor
      );

      popEffectFrame_(roomData);
      resumeEffectStack_(roomData);
      return;
    }

    const cardId =
      revealed[0];

    const card =
      getCardDefinition(cardId);

    if (
      card &&
      hasCardType_(card, 'action')
    ) {
      frame.status = 'waiting-interaction';
      frame.updatedAt =
        new Date().toISOString();

      enqueueInteraction_(
        roomData,
        {
          type:'libraryDecision',
          playerId:actor.id,
          sourceCardId:'library',
          revealedCardId:cardId,
          targetHandSize:
            frame.targetHandSize,
          currentHandSize:
            actor.state.hand.length,
          allowCancel:false
        }
      );

      return;
    }

    actor.state.hand.push(cardId);
  }

  if (
    actor.state.hand.length >=
    frame.targetHandSize
  ) {
    finishLibraryEffect_(
      roomData,
      actor
    );

    popEffectFrame_(roomData);
    resumeEffectStack_(roomData);
    return;
  }

  if (safety >= 200) {
    throw new Error(
      '圖書館效果超過安全處理上限。'
    );
  }
}


function getLegalThroneRoomChoices_(
  roomData,
  playerId
) {
  const player =
    findPlayer_(roomData, playerId);

  if (!player || !player.state) {
    return [];
  }

  return player.state.hand
    .map(function(cardId, index) {
      return {
        cardId:cardId,
        handIndex:index
      };
    })
    .filter(function(item) {
      const card =
        getCardDefinition(
          item.cardId
        );

      return Boolean(
        card &&
        hasCardType_(
          card,
          'action'
        )
      );
    });
}

function assertValidThroneRoomChoice_(
  roomData,
  playerId,
  selectedIndexes
) {
  const legalIndexes =
    getLegalThroneRoomChoices_(
      roomData,
      playerId
    ).map(function(item) {
      return item.handIndex;
    });

  const selected =
    Array.isArray(selectedIndexes)
      ? selectedIndexes.map(Number)
      : [];

  if (
    selected.length !== 1 ||
    legalIndexes.indexOf(selected[0]) === -1
  ) {
    throw new Error(
      '寶座廳只能選擇目前手牌中合法的行動卡。'
    );
  }
}

function startThroneRepeat_(
  roomData,
  actorIndex,
  repeatedCardId,
  repeatCount
) {
  const actor =
    roomData.players[actorIndex];

  pushEffectFrame_(
    roomData,
    {
      type:'throneRepeat',
      actorId:actor.id,
      repeatedCardId:repeatedCardId,
      remaining:
        Math.max(
          1,
          Number(repeatCount || 2)
        )
    }
  );

  continueThroneRepeat_(
    roomData,
    peekEffectFrame_(roomData)
  );
}

function continueThroneRepeat_(
  roomData,
  frame
) {
  if (
    getCurrentInteraction_(roomData)
  ) {
    return;
  }

  const actorIndex =
    roomData.players.findIndex(
      function(player) {
        return player.id ===
          frame.actorId;
      }
    );

  if (actorIndex < 0) {
    popEffectFrame_(roomData);
    resumeEffectStack_(roomData);
    return;
  }

  const card =
    getCardDefinition(
      frame.repeatedCardId
    );

  if (!card) {
    popEffectFrame_(roomData);
    resumeEffectStack_(roomData);
    return;
  }

  let safety = 0;

  while (
    frame.remaining > 0 &&
    !getCurrentInteraction_(roomData) &&
    safety < 20
  ) {
    safety += 1;
    frame.remaining -= 1;
    frame.status = 'running';
    frame.updatedAt =
      new Date().toISOString();

    applyCardEffects_(
      roomData,
      actorIndex,
      card
    );
  }

  if (getCurrentInteraction_(roomData)) {
    frame.status = 'waiting-interaction';
    frame.updatedAt =
      new Date().toISOString();
    return;
  }

  if (frame.remaining <= 0) {
    popEffectFrame_(roomData);
    resumeEffectStack_(roomData);
    return;
  }

  if (safety >= 20) {
    throw new Error(
      '寶座廳重複效果超過安全處理上限。'
    );
  }
}

function resolveSpy_(
  roomData,
  actorIndex
) {
  startSpySequence_(
    roomData,
    actorIndex
  );
}

function resolveThief_(
  roomData,
  actorIndex
) {
  const actor =
    roomData.players[actorIndex];

  getOpponentIndexes_(
    roomData,
    actorIndex
  ).forEach(function(index) {
    const opponent =
      roomData.players[index];

    if (
      opponent.state.hand
        .indexOf('moat') !== -1
    ) {
      enqueueInteraction_(
        roomData,
        {
          type:'reaction',
          attackType:'thiefReveal',
          sourceCardId:'thief',
          attackerId:actor.id,
          defenderId:opponent.id,
          playerId:opponent.id,
          canRevealMoat:true
        }
      );

      return;
    }

    enqueueThiefReveal_(
      roomData,
      actor,
      opponent
    );
  });
}

function enqueueThiefReveal_(
  roomData,
  actor,
  opponent
) {
  const revealed =
    revealTopCards_(
      opponent.state,
      2
    );

  const names =
    revealed.map(function(cardId) {
      const card =
        getCardDefinition(cardId);

      return card
        ? card.name
        : cardId;
    });

  addLog_(
    roomData,
    opponent.name,
    '因「小偷」翻開：' +
      (
        names.length
          ? names.join('、')
          : '沒有牌'
      )
  );

  if (!revealed.length) {
    return;
  }

  const treasureOptions =
    revealed.filter(function(cardId) {
      const card =
        getCardDefinition(cardId);

      return (
        card &&
        hasCardType_(card, 'treasure')
      );
    });

  if (!treasureOptions.length) {
    opponent.state.discard =
      opponent.state.discard.concat(
        revealed
      );

    addLog_(
      roomData,
      actor.name,
      opponent.name +
        '翻開的牌中沒有寶物可移除'
    );

    return;
  }

  enqueueInteraction_(
    roomData,
    {
      type:'thiefTrashDecision',
      playerId:actor.id,
      sourceCardId:'thief',
      targetPlayerId:opponent.id,
      targetPlayerName:opponent.name,
      revealedCardIds:revealed,
      treasureOptions:
        treasureOptions,
      allowCancel:false
    }
  );
}

function startLibraryEffect_(
  roomData,
  actorIndex,
  targetSize
) {
  const actor =
    roomData.players[actorIndex];

  actor.state.librarySetAside = [];

  continueLibraryEffect_(
    roomData,
    actor,
    targetSize
  );
}

function continueLibraryEffect_(
  roomData,
  actor,
  targetSize
) {
  targetSize =
    Number(targetSize || 7);

  while (
    actor.state.hand.length <
    targetSize
  ) {
    const revealed =
      revealTopCards_(
        actor.state,
        1
      );

    if (!revealed.length) {
      break;
    }

    const cardId =
      revealed[0];

    const card =
      getCardDefinition(cardId);

    if (
      card &&
      hasCardType_(card, 'action')
    ) {
      enqueueInteraction_(
        roomData,
        {
          type:'libraryDecision',
          playerId:actor.id,
          sourceCardId:'library',
          revealedCardId:cardId,
          targetHandSize:targetSize,
          currentHandSize:
            actor.state.hand.length,
          allowCancel:false
        }
      );

      return;
    }

    actor.state.hand.push(cardId);
  }

  finishLibraryEffect_(
    roomData,
    actor
  );
}

function finishLibraryEffect_(
  roomData,
  actor
) {
  const setAside =
    Array.isArray(
      actor.state.librarySetAside
    )
      ? actor.state.librarySetAside
      : [];

  actor.state.discard =
    actor.state.discard.concat(
      setAside
    );

  actor.state.librarySetAside = [];

  if (setAside.length) {
    addLog_(
      roomData,
      actor.name,
      '圖書館結束，旁置的 ' +
        setAside.length +
        ' 張行動卡進入棄牌堆'
    );
  }
}

