function createRoom(
  playerId,
  playerName,
  maxPlayers,
  kingdomMode,
  customCardIds,
  thinkTimeSeconds,
  timeoutMode,
  countdownSound
) {
  initializeSheets();

  playerId = cleanText(playerId);
  playerName = cleanPlayerName(playerName);
  maxPlayers = Number(maxPlayers);

  if (!playerId) {
    throw new Error('找不到玩家識別碼。');
  }

  if (!playerName) {
    throw new Error('請輸入玩家名稱。');
  }

  if (
    !Number.isInteger(maxPlayers) ||
    maxPlayers < 2 ||
    maxPlayers > 8
  ) {
    throw new Error('玩家人數必須是 2～8 人。');
  }

  return withRoomLock_(function() {
    const sheet = getRoomSheet();
    const roomNumber =
      generateUniqueRoomNumber(sheet);

    const kingdomSelection =
      buildKingdomSelection_(
        kingdomMode || 'balanced',
        customCardIds
      );

    const timerRules =
      normalizeTimerRules_(
        thinkTimeSeconds,
        timeoutMode,
        countdownSound
      );

    const roomData = createWaitingRoomData_(
      roomNumber,
      maxPlayers,
      playerId,
      playerName,
      kingdomSelection,
      timerRules
    );

    const roomJsonChunks =
      encodeRoomDataChunks_(roomData);

    sheet.appendRow(
      buildRoomSheetRow_(
        roomNumber,
        '等待玩家',
        maxPlayers,
        roomJsonChunks,
        new Date(),
        1
      )
    );

    SpreadsheetApp.flush();

    return {
      success:true,
      roomNumber:roomNumber,
      playerRole:'host',
      maxPlayers:maxPlayers,
      message:'房間建立成功'
    };
  });
}

function joinRoom(roomNumber, playerId, playerName) {
  initializeSheets();

  roomNumber = cleanRoomNumber(roomNumber);
  playerId = cleanText(playerId);
  playerName = cleanPlayerName(playerName);

  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;

    repairRoomStateForReconnect_(
      roomData
    );

    const existing =
      findPlayer_(roomData, playerId);

    /*
     * V15.4：原玩家重新連線必須優先處理。
     * 不能先因遊戲已開始而拒絕，否則誤按離開後就回不來。
     */
    if (existing) {
      existing.connected = true;
      existing.lastSeenAt =
        new Date().toISOString();

      if (playerName) {
        existing.name = playerName;
      }

      /*
       * V19.0.2：
       * 原真人重新連線時，立即取回控制權。
       * 不必等到再次輪到自己，也不必先找到
       * 「恢復真人控制」按鈕。
       */
      const wasAiControlled =
        Boolean(
          !existing.isAi &&
          existing.aiControlled
        );

      if (wasAiControlled) {
        existing.aiControlled = false;
        existing.aiControlMode = '';

        addLog_(
          roomData,
          existing.name,
          '重新連線後立即恢復真人控制'
        );
      } else if (
        roomData.status === '遊戲中' ||
        roomData.status === '遊戲結束'
      ) {
        addLog_(
          roomData,
          existing.name,
          '已重新連線並返回遊戲'
        );
      }

      /*
       * 若目前正等待此玩家操作，
       * 重新給完整思考時間。
       */
      if (
        roomData.status === '遊戲中' &&
        isCurrentDecisionPlayer_(
          roomData,
          existing.id
        )
      ) {
        resetPlayerTimer_(
          roomData,
          existing.id
        );
      }

      saveRoomContext_(context);

      return {
        success:true,
        roomNumber:roomNumber,
        playerRole:
          existing.isHost ? 'host' : 'player',
        resumed:
          roomData.status !== '等待玩家',
        message:
          roomData.status === '等待玩家'
            ? '已重新進入房間'
            : '已返回原本遊戲，牌庫與手牌已保留'
      };
    }

    if (roomData.status !== '等待玩家') {
      throw new Error(
        '這個房間已經開始；只有原本的玩家可以重新加入。'
      );
    }

    if (roomData.players.length >= roomData.maxPlayers) {
      throw new Error('這個房間已經滿員。');
    }

    roomData.players.push(
      createPlayerRecord_(
        playerId,
        playerName,
        false
      )
    );

    saveRoomContext_(context);

    return {
      success:true,
      roomNumber:roomNumber,
      playerRole:'player',
      message:'成功加入房間'
    };
  });
}


/**
 * V15 輕量同步檢查。
 * 只讀取房號、狀態與版本號，不解析大型房間 JSON。
 */
function getRoomVersion(roomNumber) {
  roomNumber = cleanRoomNumber(roomNumber);

  const sheet = getRoomSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return {
      success:false,
      roomExists:false,
      version:0
    };
  }

  const values = sheet
    .getRange(2, 1, lastRow - 1, ROOM_COLUMNS)
    .getValues();

  const displayedRoomNumbers =
    sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getDisplayValues();

  for (let i = 0; i < values.length; i++) {
    const currentRoomNumber =
      String(
        displayedRoomNumbers[i][0] ||
        values[i][0] ||
        ''
      )
        .replace(/\D/g, '')
        .padStart(4, '0')
        .slice(-4);

    if (currentRoomNumber === roomNumber) {
      return {
        success:true,
        roomExists:true,
        status:String(values[i][1] || ''),
        version:Number(values[i][5] || 0),
        updatedAt:values[i][4]
      };
    }
  }

  return {
    success:false,
    roomExists:false,
    version:0
  };
}



function advanceRoomServerSide(
  roomNumber,
  requesterId
) {
  roomNumber =
    cleanRoomNumber(roomNumber);

  requesterId =
    cleanText(requesterId);

  if (!roomNumber) {
    return {
      success:false,
      processed:false
    };
  }

  /*
   * 先做無鎖讀取。
   * 等待室不需要 AI、超時或心跳推進，
   * 因此直接返回，避免所有大廳玩家每次輪詢都搶全域 Lock。
   */
  const preview =
    loadRoomContext_(
      roomNumber,
      true
    );

  if (!preview) {
    return {
      success:false,
      processed:false,
      roomExists:false
    };
  }

  if (
    preview.roomData.status !==
    '遊戲中'
  ) {
    return {
      success:true,
      processed:false,
      roomExists:true
    };
  }

  return withRoomLock_(function() {
    const context =
      loadRoomContext_(
        roomNumber,
        true
      );

    if (!context) {
      return {
        success:false,
        processed:false,
        roomExists:false
      };
    }

    const roomData =
      context.roomData;

    repairRoomStateForReconnect_(
      roomData
    );

    const requester =
      findPlayer_(
        roomData,
        requesterId
      );

    let heartbeatChanged = false;

    if (
      requester &&
      !requester.isAi
    ) {
      const now =
        Date.now();

      const previous =
        requester.lastSeenAt
          ? new Date(
              requester.lastSeenAt
            ).getTime()
          : 0;

      requester.connected = true;

      /*
       * 心跳最多每 5 秒寫入一次，
       * 不必每次畫面輪詢都寫試算表。
       */
      if (
        !Number.isFinite(previous) ||
        now - previous >= 5000
      ) {
        requester.lastSeenAt =
          new Date(now).toISOString();

        heartbeatChanged = true;
      }
    }

    if (
      !hasRecentHumanHeartbeat_(
        roomData,
        12
      )
    ) {
      const changed =
        roomData.serverAdvancePaused !==
        true;

      roomData.serverAdvancePaused =
        true;

      if (
        changed ||
        heartbeatChanged
      ) {
        saveRoomContext_(context);
      }

      return {
        success:true,
        processed:false,
        roomExists:true,
        pausedNoHuman:true
      };
    }

    let changed =
      roomData.serverAdvancePaused ===
      true;

    roomData.serverAdvancePaused =
      false;

    if (
      processExpiredDecisionInMemory_(
        roomData
      )
    ) {
      changed = true;
    }

    /*
     * 每次同步最多執行一個 AI 步驟，
     * 避免單次請求佔用 Lock 太久。
     */
    if (
      !getCurrentInteraction_(roomData) &&
      peekEffectFrame_(roomData)
    ) {
      resumeEffectStack_(roomData);
      changed = true;
    }

    if (
      isAiStepNeeded_(roomData)
    ) {
      try {
        processSingleAiStepInMemory_(
          roomData
        );
      } catch (error) {
        recoverAiStep_(
          roomData,
          error
        );
      }

      resetCurrentTimer_(roomData);
      changed = true;
    }

    if (
      changed ||
      heartbeatChanged
    ) {
      saveRoomContext_(context);
    }

    return {
      success:true,
      processed:changed,
      roomExists:true,
      pausedNoHuman:false
    };
  });
}

function hasRecentHumanHeartbeat_(
  roomData,
  maxAgeSeconds
) {
  const now = Date.now();
  const maxAge =
    Math.max(
      3,
      Number(maxAgeSeconds || 12)
    ) * 1000;

  return roomData.players.some(function(player) {
    if (
      player.isAi ||
      !player.lastSeenAt
    ) {
      return false;
    }

    const seenAt =
      new Date(
        player.lastSeenAt
      ).getTime();

    return (
      Number.isFinite(seenAt) &&
      now - seenAt <= maxAge
    );
  });
}

function processSingleAiStepInMemory_(
  roomData
) {
  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    processAiInteraction_(
      roomData,
      interaction
    );
    return;
  }

  if (roomData.phase === 'action') {
    processAiAction_(roomData);
    return;
  }

  if (roomData.phase === 'buy') {
    processAiPurchase_(roomData);
  }
}

function processExpiredDecisionInMemory_(
  roomData
) {
  const rules =
    roomData.timerRules ||
    normalizeTimerRules_(
      0,
      'ai',
      true
    );

  if (
    roomData.status !== '遊戲中' ||
    roomData.timerPaused ||
    Number(
      rules.thinkTimeSeconds || 0
    ) <= 0
  ) {
    return false;
  }

  const now = Date.now();

  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    const target =
      findPlayer_(
        roomData,
        interaction.playerId
      );

    return processExpiredPlayer_(
      roomData,
      target,
      rules,
      now,
      true
    );
  }

  if (roomData.phase === 'action') {
    const target =
      roomData.players[
        Number(
          roomData.actionIndex || 0
        )
      ] || null;

    return processExpiredPlayer_(
      roomData,
      target,
      rules,
      now,
      false
    );
  }

  if (roomData.phase === 'buy') {
    const expiredPlayer =
      roomData.players.find(function(player) {
        return (
          !player.buyFinished &&
          !player.isAi &&
          !player.aiControlled &&
          player.timerDeadlineAt &&
          now >=
            new Date(
              player.timerDeadlineAt
            ).getTime()
        );
      });

    return processExpiredPlayer_(
      roomData,
      expiredPlayer,
      rules,
      now,
      false
    );
  }

  return false;
}


function autoResolveTimedOutInteraction_(
  roomData,
  target,
  reason
) {
  if (!roomData || !target) {
    return false;
  }

  let interaction =
    getCurrentInteraction_(roomData);

  if (
    !interaction ||
    interaction.playerId !== target.id
  ) {
    return false;
  }

  /*
   * 「自動完成階段」遇到民兵棄牌、護城河反應、
   * 間諜、小偷、圖書館或通用選牌時，
   * 不能直接把玩家標成 actionFinished／buyFinished。
   *
   * 這裡暫時讓該真人使用 AI 的互動決策器，
   * 只處理目前必須完成的卡片效果，不會改成持續 AI 接管。
   */
  const originalAiControlled =
    Boolean(target.aiControlled);

  const originalManualAiControl =
    Boolean(target.manualAiControl);

  const originalMode =
    target.aiControlMode || '';

  const originalDifficulty =
    target.aiDifficulty || '';

  target.aiControlled = true;
  target.manualAiControl = false;
  target.aiControlMode =
    target.aiControlMode || 'balanced';
  target.aiDifficulty =
    target.aiDifficulty || 'normal';

  let safety = 0;

  try {
    while (safety < 30) {
      safety += 1;

      interaction =
        getCurrentInteraction_(roomData);

      if (
        !interaction ||
        interaction.playerId !== target.id
      ) {
        break;
      }

      processAiInteraction_(
        roomData,
        interaction
      );

      runEffectEngine_(
        roomData,
        'timeout-auto-interaction'
      );

      const nextInteraction =
        getCurrentInteraction_(roomData);

      if (
        nextInteraction === interaction
      ) {
        /*
         * 最後防呆：若某個舊互動沒有被 AI resolver 消除，
         * 至少完成它並繼續效果堆疊，避免整局永久鎖死。
         */
        completeCurrentInteraction_(
          roomData
        );

        runEffectEngine_(
          roomData,
          'timeout-force-complete'
        );
      }
    }
  } finally {
    target.aiControlled =
      originalAiControlled;

    target.manualAiControl =
      originalManualAiControl;

    target.aiControlMode =
      originalMode;

    target.aiDifficulty =
      originalDifficulty;
  }

  addLog_(
    roomData,
    target.name,
    String(
      reason ||
      '思考時間到，自動處理卡片效果'
    )
  );

  resetCurrentTimer_(roomData);

  return true;
}

function processExpiredPlayer_(
  roomData,
  target,
  rules,
  now,
  hasInteraction
) {
  if (
    !target ||
    target.buyFinished ||
    target.isAi ||
    target.aiControlled ||
    !target.timerDeadlineAt ||
    now <
      new Date(
        target.timerDeadlineAt
      ).getTime()
  ) {
    return false;
  }

  if (
    hasInteraction &&
    rules.timeoutMode === 'finish'
  ) {
    return autoResolveTimedOutInteraction_(
      roomData,
      target,
      '思考時間到，自動完成目前卡片效果'
    );
  }

  if (rules.timeoutMode === 'ai') {
    target.aiControlled = true;
    target.aiControlMode =
      target.aiControlMode ||
      'balanced';

    if (!target.aiDifficulty) {
      target.aiDifficulty = 'hard';
    }

    target.timerDeadlineAt = '';

    addLog_(
      roomData,
      target.name,
      '思考時間到，由伺服器自動交給 AI 接管'
    );

    return true;
  }

  if (
    hasInteraction &&
    rules.timeoutMode === 'skip'
  ) {
    addLog_(
      roomData,
      target.name,
      '思考時間到，自動略過目前互動'
    );

    completeCurrentInteraction_(
      roomData
    );

    runEffectEngine_(
      roomData,
      'timeout-skip-interaction'
    );

    resetCurrentTimer_(roomData);
    return true;
  }

  if (roomData.phase === 'action') {
    target.actionFinished = true;
    target.timerDeadlineAt = '';

    addLog_(
      roomData,
      target.name,
      '思考時間到，自動完成行動階段'
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
      enterSimultaneousBuyPhase_(
        roomData
      );
    } else {
      resetCurrentTimer_(roomData);
    }

    return true;
  }

  if (roomData.phase === 'buy') {
    target.buyFinished = true;
    target.timerDeadlineAt = '';

    addLog_(
      roomData,
      target.name,
      '思考時間到，自動完成購買'
    );

    if (
      roomData.players.every(
        function(player) {
          return player.buyFinished;
        }
      )
    ) {
      cleanupAllPlayers_(roomData);
      startNextRound_(roomData);
    }

    return true;
  }

  if (hasInteraction) {
    return autoResolveTimedOutInteraction_(
      roomData,
      target,
      '思考時間到，自動處理目前互動'
    );
  }

  return false;
}


function repairRoomStateForReconnect_(
  roomData
) {
  if (!roomData) return;

  if (
    !Array.isArray(
      roomData.players
    )
  ) {
    roomData.players = [];
  }

  if (
    !Array.isArray(
      roomData.interactionQueue
    )
  ) {
    roomData.interactionQueue = [];
  }

  if (
    !Array.isArray(
      roomData.interactionHistory
    )
  ) {
    roomData.interactionHistory = [];
  }

  roomData.interactionSequence =
    Number(roomData.interactionSequence || 0);

  if (
    !Array.isArray(roomData.log)
  ) {
    roomData.log = [];
  }

  if (
    !Array.isArray(
      roomData.effectStack
    )
  ) {
    roomData.effectStack = [];
  }

  roomData.effectStackVersion =
    Number(roomData.effectStackVersion || 0);

  roomData.engineVersion =
    Number(roomData.engineVersion || 0);

  roomData.engineEventSequence =
    Number(roomData.engineEventSequence || 0);

  if (!Array.isArray(roomData.engineEvents)) {
    roomData.engineEvents = [];
  }

  if (!Array.isArray(roomData.attackSequences)) {
    roomData.attackSequences = [];
  }

  ensureRoomHealth_(roomData);

  roomData.attackSequenceCounter =
    Number(
      roomData.attackSequenceCounter || 0
    );

  roomData.effectFrameSequence =
    Number(roomData.effectFrameSequence || 0);

  roomData.effectStack.forEach(
    function(frame, index) {
      if (!frame.frameId) {
        roomData.effectFrameSequence += 1;

        frame.frameId =
          'fx_repair_' +
          roomData.effectFrameSequence +
          '_' +
          new Date().getTime() +
          '_' +
          index;
      }

      frame.status =
        frame.status || 'waiting';

      frame.parentFrameId =
        frame.parentFrameId || '';
    }
  );

  roomData.players.forEach(
    function(player) {
      if (!player) return;

      if (
        player.connected == null
      ) {
        player.connected = true;
      }

      if (
        player.aiControlled == null
      ) {
        player.aiControlled = false;
      }

      if (
        player.manualAiControl == null
      ) {
        player.manualAiControl = false;
      }

      if (
        !player.state &&
        roomData.status === '遊戲中'
      ) {
        player.state = {
          hand:[],
          deck:[],
          discard:[],
          play:[],
          actions:0,
          buys:0,
          coins:0
        };
      }
    }
  );

  /*
   * 只清除明確無效的互動，不會在玩家離開時
   * 整批清空 interactionQueue，以免破壞正在進行的牌效。
   */
  roomData.interactionQueue =
    roomData.interactionQueue.filter(
      function(interaction) {
        if (
          !interaction ||
          !interaction.type ||
          !interaction.playerId
        ) {
          return false;
        }

        return Boolean(
          findPlayer_(
            roomData,
            interaction.playerId
          )
        );
      }
    );

  roomData.interactionQueue.forEach(
    function(interaction) {
      if (!interaction.interactionId) {
        roomData.interactionSequence += 1;
        interaction.interactionId =
          'ix_repair_' +
          roomData.interactionSequence +
          '_' +
          new Date().getTime();
      }

      interaction.sequence =
        Number(
          interaction.sequence ||
          roomData.interactionSequence
        );
      interaction.status =
        interaction.status || 'waiting';
    }
  );

  if (
    roomData.status === '遊戲中'
  ) {
    const maxIndex =
      Math.max(
        0,
        roomData.players.length - 1
      );

    roomData.actionIndex =
      Math.max(
        0,
        Math.min(
          Number(
            roomData.actionIndex || 0
          ),
          maxIndex
        )
      );
  }
}


function isCurrentDecisionPlayer_(
  roomData,
  playerId
) {
  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    return (
      interaction.playerId ===
      playerId
    );
  }

  if (roomData.phase === 'action') {
    const active =
      roomData.players[
        Number(
          roomData.actionIndex || 0
        )
      ];

    return Boolean(
      active &&
      active.id === playerId &&
      !active.actionFinished
    );
  }

  if (roomData.phase === 'buy') {
    const player =
      findPlayer_(
        roomData,
        playerId
      );

    return Boolean(
      player &&
      !player.buyFinished
    );
  }

  return false;
}

function getClientState(roomNumber, playerId) {
  const performanceStartedAt =
    Date.now();

  roomNumber = cleanRoomNumber(roomNumber);
  playerId = cleanText(playerId);

  const loadStartedAt =
    Date.now();

  const context =
    loadRoomContext_(
      roomNumber,
      true
    );

  const roomLoadMs =
    Date.now() - loadStartedAt;

  if (!context) {
    return {
      success:false,
      roomExists:false,
      view:'home',
      message:'房間不存在'
    };
  }

  const roomData = context.roomData;

  repairRoomStateForReconnect_(
    roomData
  );

  const automaticRepair =
    repairRoomState_(
      roomData,
      'client-state-check'
    );

  if (automaticRepair.repaired) {
    saveRoomContext_(context);
  }

  const playerIndex =
    roomData.players.findIndex(function(player) {
      return player.id === playerId;
    });

  if (playerIndex === -1) {
    return {
      success:false,
      roomExists:true,
      view:'home',
      message:'你不在這個房間中，請重新加入。'
    };
  }

  const player = roomData.players[playerIndex];

  const result = {
    success:true,
    roomExists:true,
    roomNumber:roomData.roomNumber,
    status:roomData.status,
    maxPlayers:roomData.maxPlayers,
    playerCount:roomData.players.length,
    playerRole:player.isHost ? 'host' : 'player',
    version:context.version,
    view:
      roomData.status === '等待玩家'
        ? 'lobby'
        : 'game'
  };

  if (result.view === 'lobby') {
    result.players =
      roomData.players.map(function(item, index) {
        return {
          id:item.id,
          name:item.name,
          isHost:Boolean(item.isHost),
          isAi:Boolean(item.isAi),
          aiDifficulty:item.aiDifficulty || '',
          seat:index + 1,
          connected:item.connected !== false
        };
      });

    result.canStart =
      Boolean(player.isHost) &&
      roomData.players.length === roomData.maxPlayers;

    result.kingdomMode =
      roomData.kingdomMode || 'balanced';

    result.kingdomCardIds =
      (roomData.kingdomCardIds || []).slice();

    result.cardCatalog =
      getPublicCardCatalog();

    result.timerRules =
      roomData.timerRules ||
      normalizeTimerRules_(0, 'ai', true);

    result.performance = {
      cacheHit:
        Boolean(context.cacheHit),
      roomLoadMs:roomLoadMs,
      totalMs:
        Date.now() -
        performanceStartedAt
    };

    return result;
  }

  const interaction = getCurrentInteraction_(roomData);
  const activePlayer =
    roomData.players[Number(roomData.actionIndex || 0)] || null;
  const own = player.state || {
    hand:[],play:[],deck:[],discard:[],
    actions:0,buys:0,coins:0
  };

  result.kingdomMode =
    roomData.kingdomMode || 'balanced';

  result.kingdomCardIds =
    (roomData.kingdomCardIds || []).slice();

  result.emptyPileLimit =
    Number(roomData.emptyPileLimit || 3);

  result.timerRules =
    roomData.timerRules ||
    normalizeTimerRules_(0, 'ai', true);

  result.timer =
    buildTimerSnapshot_(
      roomData,
      playerId
    );

  result.serverAdvancePaused =
    Boolean(
      roomData.serverAdvancePaused
    );

  result.phase = roomData.phase;
  result.roundNumber = Number(roomData.roundNumber || 0);
  result.activeActionPlayerId =
    activePlayer ? activePlayer.id : '';
  result.activeActionPlayerName =
    activePlayer ? activePlayer.name : '';
  result.isActionPlayer =
    roomData.phase === 'action' &&
    activePlayer &&
    activePlayer.id === playerId;
  result.canFinishAction =
    Boolean(
      result.isActionPlayer &&
      !interaction &&
      (
        !roomData.interactionQueue ||
        roomData.interactionQueue.length === 0
      ) &&
      (
        !roomData.effectStack ||
        roomData.effectStack.length === 0
      )
    );
  result.canBuy =
    roomData.phase === 'buy' &&
    !player.buyFinished &&
    !interaction;
  result.buyFinished = Boolean(player.buyFinished);

  result.player = {
    id:player.id,
    name:player.name,
    isAi:Boolean(player.isAi),
    aiControlled:
      Boolean(player.aiControlled),
    manualAiControl:
      Boolean(player.manualAiControl),
    hand:(own.hand || []).slice(),
    play:(own.play || []).slice(),
    deckCount:(own.deck || []).length,
    discardCount:(own.discard || []).length,
    actions:Number(own.actions || 0),
    buys:Number(own.buys || 0),
    coins:Number(own.coins || 0),
    deckInspector:
      buildPlayerDeckInspector_(own)
  };

  result.players =
    roomData.players.map(function(item, index) {
      const state = item.state || {
        hand:[],deck:[],discard:[]
      };

      return {
        id:item.id,
        name:item.name,
        seat:index + 1,
        isHost:Boolean(item.isHost),
        isAi:Boolean(item.isAi),
        aiDifficulty:item.aiDifficulty || '',
        aiControlled:Boolean(item.aiControlled),
        manualAiControl:
          Boolean(item.manualAiControl),
        connected:item.connected !== false,
        handCount:(state.hand || []).length,
        deckCount:(state.deck || []).length,
        discardCount:(state.discard || []).length,
        actionFinished:Boolean(item.actionFinished),
        buyFinished:Boolean(item.buyFinished)
      };
    });

  result.aiEngine = {
    activePlayers:
      roomData.players
        .filter(function(item) {
          return Boolean(
            item &&
            (
              item.isAi ||
              item.aiControlled
            )
          );
        })
        .map(function(item) {
          return {
            playerId:item.id,
            playerName:item.name,
            difficulty:
              item.aiDifficulty || 'normal',
            mode:
              item.aiControlMode ||
              'balanced',
            lastPurchaseAnalysis:
              item.lastAiPurchaseAnalysis
                ? JSON.parse(
                    JSON.stringify(
                      item.lastAiPurchaseAnalysis
                    )
                  )
                : null,
            lastActionAnalysis:
              item.lastAiActionAnalysis
                ? JSON.parse(
                    JSON.stringify(
                      item.lastAiActionAnalysis
                    )
                  )
                : null
          };
        })
  };

  result.supply =
    JSON.parse(JSON.stringify(roomData.supply || {}));
  result.cardCatalog = getPublicCardCatalog();
  result.interaction =
    interaction
      ? JSON.parse(JSON.stringify(interaction))
      : null;

  const activeAttackSequence =
    Array.isArray(
      roomData.attackSequences
    ) &&
    roomData.attackSequences.length
      ? roomData.attackSequences[
          roomData.attackSequences.length - 1
        ]
      : null;

  result.attackEngine = {
    depth:
      Array.isArray(
        roomData.attackSequences
      )
        ? roomData.attackSequences.length
        : 0,
    active:
      activeAttackSequence
        ? {
            attackSequenceId:
              activeAttackSequence
                .attackSequenceId || '',
            sourceCardId:
              activeAttackSequence
                .sourceCardId || '',
            attackerId:
              activeAttackSequence
                .attackerId || '',
            attackType:
              activeAttackSequence
                .attackType || '',
            status:
              activeAttackSequence
                .status || '',
            currentTargetIndex:
              Number(
                activeAttackSequence
                  .currentTargetIndex || 0
              ),
            targetCount:
              Array.isArray(
                activeAttackSequence
                  .targetPlayerIds
              )
                ? activeAttackSequence
                    .targetPlayerIds.length
                : 0,
            currentTargetId:
              (
                activeAttackSequence
                  .targetPlayerIds || []
              )[
                Number(
                  activeAttackSequence
                    .currentTargetIndex || 0
                )
              ] || ''
          }
        : null
  };

  result.effectEngine = {
    engineVersion:
      Number(roomData.engineVersion || 0),
    stackDepth:
      Array.isArray(roomData.effectStack)
        ? roomData.effectStack.length
        : 0,
    stackVersion:
      Number(roomData.effectStackVersion || 0),
    hasPendingInteraction:
      Boolean(getCurrentInteraction_(roomData)),
    stack:
      Array.isArray(roomData.effectStack)
        ? roomData.effectStack.map(
            function(frame, index) {
              return {
                index:index,
                frameId:frame.frameId || '',
                parentFrameId:
                  frame.parentFrameId || '',
                type:frame.type || '',
                status:frame.status || '',
                actorId:frame.actorId || '',
                sourceCardId:
                  frame.sourceCardId || '',
                cardId:frame.cardId || ''
              };
            }
          )
        : [],
    events:
      Array.isArray(roomData.engineEvents)
        ? roomData.engineEvents.slice(-40)
        : []
  };

  result.interactionEngine = {
    queueLength:
      Array.isArray(roomData.interactionQueue)
        ? roomData.interactionQueue.length
        : 0,
    sequence:
      Number(roomData.interactionSequence || 0),
    currentInteractionId:
      interaction
        ? (interaction.interactionId || '')
        : '',
    currentType:
      interaction
        ? interaction.type
        : '',
    history:
      Array.isArray(roomData.interactionHistory)
        ? roomData.interactionHistory.slice(-10)
        : []
  };

  result.roomHealth =
    getRoomHealthSnapshot_(
      roomData
    );

  result.safeComplete = {
    count:Array.isArray(roomData.safeCompleteLog) ? roomData.safeCompleteLog.length : 0,
    recent:Array.isArray(roomData.safeCompleteLog) ? roomData.safeCompleteLog.slice(-20) : []
  };

  result.isInteractionPlayer =
    Boolean(interaction) &&
    interaction.playerId === playerId;
  result.gameOver =
    roomData.status === '遊戲結束';
  result.result =
    roomData.result
      ? JSON.parse(JSON.stringify(roomData.result))
      : null;
  result.log =
    (roomData.log || []).slice(-40);

  result.aiStepNeeded =
    isAiStepNeeded_(roomData);

  result.isAiDriver =
    Boolean(player.isHost);

  result.performance = {
    cacheHit:
      Boolean(context.cacheHit),
    roomLoadMs:roomLoadMs,
    totalMs:
      Date.now() -
      performanceStartedAt
  };

  return result;
}



function buildPlayerDeckInspector_(playerState) {
  const definitions = getCardDefinitions();

  const zones = {
    hand:Array.isArray(playerState.hand) ? playerState.hand : [],
    deck:Array.isArray(playerState.deck) ? playerState.deck : [],
    discard:Array.isArray(playerState.discard) ? playerState.discard : [],
    play:Array.isArray(playerState.play) ? playerState.play : []
  };

  const cardsById = {};

  Object.keys(zones).forEach(function(zoneName) {
    zones[zoneName].forEach(function(cardId) {
      if (!cardsById[cardId]) {
        const card = definitions[cardId] || {};

        cardsById[cardId] = {
          cardId:cardId,
          name:card.name || cardId,
          type:card.type || 'other',
          cssClass:card.cssClass || card.type || 'other',
          cost:Number(card.cost || 0),
          description:card.description || '',
          total:0,
          hand:0,
          deck:0,
          discard:0,
          play:0
        };
      }

      cardsById[cardId].total += 1;
      cardsById[cardId][zoneName] += 1;
    });
  });

  const cards = Object.keys(cardsById)
    .map(function(cardId) {
      return cardsById[cardId];
    })
    .sort(function(left, right) {
      const order = {
        action:1,
        treasure:2,
        victory:3,
        curse:4,
        other:5
      };

      const leftOrder = order[left.type] || 9;
      const rightOrder = order[right.type] || 9;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      if (left.cost !== right.cost) {
        return left.cost - right.cost;
      }

      return left.name.localeCompare(right.name);
    });

  const summary = {
    totalCards:0,
    actionCards:0,
    treasureCards:0,
    victoryCards:0,
    curseCards:0,
    uniqueCards:cards.length
  };

  cards.forEach(function(card) {
    summary.totalCards += card.total;

    if (hasCardType_(card, 'action')) {
      summary.actionCards += card.total;
    } else if (hasCardType_(card, 'treasure')) {
      summary.treasureCards += card.total;
    } else if (hasCardType_(card, 'victory')) {
      summary.victoryCards += card.total;
    } else if (hasCardType_(card, 'curse')) {
      summary.curseCards += card.total;
    }
  });

  return {
    summary:summary,
    cards:cards
  };
}


function normalizeTimerRules_(
  thinkTimeSeconds,
  timeoutMode,
  countdownSound
) {
  const allowedSeconds = [
    0,
    30,
    60,
    180,
    300,
    600
  ];

  let seconds =
    Number(thinkTimeSeconds || 0);

  if (
    allowedSeconds.indexOf(seconds) === -1
  ) {
    seconds = 0;
  }

  timeoutMode =
    cleanText(timeoutMode).toLowerCase();

  if (
    ['ai', 'finish', 'skip']
      .indexOf(timeoutMode) === -1
  ) {
    timeoutMode = 'ai';
  }

  return {
    thinkTimeSeconds:seconds,
    timeoutMode:timeoutMode,
    countdownSound:
      countdownSound !== false
  };
}

function getTimerOwner_(roomData) {
  if (
    !roomData ||
    roomData.status !== '遊戲中' ||
    roomData.timerPaused
  ) {
    return null;
  }

  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    return findPlayer_(
      roomData,
      interaction.playerId
    );
  }

  if (roomData.phase === 'action') {
    return roomData.players[
      Number(roomData.actionIndex || 0)
    ] || null;
  }

  return null;
}

function resetPlayerTimer_(
  roomData,
  playerId
) {
  const rules =
    roomData.timerRules ||
    normalizeTimerRules_(0, 'ai', true);

  const seconds =
    Number(rules.thinkTimeSeconds || 0);

  const player =
    findPlayer_(roomData, playerId);

  if (!player) return;

  roomData.timerSequence =
    Number(roomData.timerSequence || 0) + 1;

  if (
    player.isAi ||
    player.aiControlled
  ) {
    player.timerDeadlineAt = '';
    return;
  }

  player.timerDeadlineAt =
    seconds > 0
      ? new Date(
          Date.now() + seconds * 1000
        ).toISOString()
      : '';
}

function resetCurrentTimer_(roomData) {
  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    resetPlayerTimer_(
      roomData,
      interaction.playerId
    );
    return;
  }

  if (roomData.phase === 'action') {
    const active =
      roomData.players[
        Number(roomData.actionIndex || 0)
      ];

    if (active) {
      resetPlayerTimer_(
        roomData,
        active.id
      );
    }
    return;
  }

  if (roomData.phase === 'buy') {
    roomData.players.forEach(function(player) {
      if (
        player.buyFinished ||
        player.isAi ||
        player.aiControlled
      ) {
        player.timerDeadlineAt = '';
        return;
      }

      resetPlayerTimer_(
        roomData,
        player.id
      );
    });
  }
}

function buildTimerSnapshot_(
  roomData,
  viewerId
) {
  const rules =
    roomData.timerRules ||
    normalizeTimerRules_(0, 'ai', true);

  const seconds =
    Number(rules.thinkTimeSeconds || 0);

  if (
    seconds <= 0 ||
    roomData.status !== '遊戲中'
  ) {
    return {
      enabled:false,
      paused:Boolean(roomData.timerPaused),
      thinkTimeSeconds:seconds,
      timeoutMode:rules.timeoutMode,
      countdownSound:
        rules.countdownSound !== false
    };
  }

  let owner = null;

  const interaction =
    getCurrentInteraction_(roomData);

  if (interaction) {
    owner =
      findPlayer_(
        roomData,
        interaction.playerId
      );
  } else if (
    roomData.phase === 'action'
  ) {
    owner =
      roomData.players[
        Number(roomData.actionIndex || 0)
      ] || null;
  } else if (
    roomData.phase === 'buy'
  ) {
    const viewer =
      findPlayer_(roomData, viewerId);

    const unfinishedPlayers =
      roomData.players.filter(function(player) {
        return !player.buyFinished;
      });

    /*
     * 同時購買階段，每位未完成者都有自己的計時。
     * 已完成購買的觀看者，改顯示第一位尚未完成者，
     * 不再錯誤顯示自己仍在思考。
     */
    if (
      viewer &&
      !viewer.buyFinished
    ) {
      owner = viewer;
    } else {
      owner =
        unfinishedPlayers.length
          ? unfinishedPlayers[0]
          : null;
    }
  }

  const pendingBuyers =
    roomData.phase === 'buy'
      ? roomData.players
          .filter(function(player) {
            return !player.buyFinished;
          })
          .map(function(player) {
            return {
              id:player.id,
              name:player.name,
              isAi:Boolean(player.isAi),
              aiControlled:
                Boolean(player.aiControlled),
              manualAiControl:
                Boolean(
                  player.manualAiControl
                ),
              deadlineAt:
                player.timerDeadlineAt || ''
            };
          })
      : [];

  return {
    enabled:true,
    paused:Boolean(roomData.timerPaused),
    thinkTimeSeconds:seconds,
    timeoutMode:rules.timeoutMode,
    countdownSound:
      rules.countdownSound !== false,
    ownerId:owner ? owner.id : '',
    ownerName:owner ? owner.name : '',
    deadlineAt:
      owner && owner.timerDeadlineAt
        ? owner.timerDeadlineAt
        : '',
    /*
     * isViewerOwner：目前計時對象就是觀看者本人。
     * 用於顯示「恢復真人控制」按鈕。
     *
     * isViewerTimer：只有尚未被 AI 接管的真人，
     * 才負責從瀏覽器送出超時請求。
     */
    isViewerOwner:
      Boolean(owner) &&
      owner.id === viewerId,
    isViewerTimer:
      Boolean(owner) &&
      owner.id === viewerId &&
      !owner.aiControlled,
    aiControlled:
      Boolean(owner && owner.aiControlled),
    manualAiControl:
      Boolean(
        owner &&
        owner.manualAiControl
      ),
    isAiThinking:
      Boolean(
        owner &&
        (
          owner.isAi ||
          owner.aiControlled
        )
      ),
    isSimultaneousBuy:
      roomData.phase === 'buy',
    pendingBuyers:pendingBuyers,
    pendingBuyerCount:
      pendingBuyers.length,
    sequence:
      Number(roomData.timerSequence || 0)
  };
}

function processRoomTimeout(
  roomNumber,
  requesterId
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData =
      context.roomData;

    const rules =
      roomData.timerRules ||
      normalizeTimerRules_(0, 'ai', true);

    if (
      roomData.status !== '遊戲中' ||
      roomData.timerPaused ||
      Number(rules.thinkTimeSeconds || 0) <= 0
    ) {
      return {
        success:true,
        processed:false
      };
    }

    let target = null;

    const interaction =
      getCurrentInteraction_(roomData);

    if (interaction) {
      target =
        findPlayer_(
          roomData,
          interaction.playerId
        );
    } else if (
      roomData.phase === 'action'
    ) {
      target =
        roomData.players[
          Number(roomData.actionIndex || 0)
        ] || null;
    } else if (
      roomData.phase === 'buy'
    ) {
      target =
        findPlayer_(
          roomData,
          requesterId
        );
    }

    if (
      !target ||
      target.buyFinished ||
      target.aiControlled ||
      !target.timerDeadlineAt ||
      Date.now() <
        new Date(
          target.timerDeadlineAt
        ).getTime()
    ) {
      return {
        success:true,
        processed:false
      };
    }

    if (
      interaction &&
      rules.timeoutMode === 'finish'
    ) {
      autoResolveTimedOutInteraction_(
        roomData,
        target,
        '思考時間到，自動完成目前卡片效果'
      );
    } else if (rules.timeoutMode === 'ai') {
      target.aiControlled = true;

      if (!target.aiDifficulty) {
        target.aiDifficulty = 'normal';
      }

      addLog_(
        roomData,
        target.name,
        '思考時間到，由 AI 暫時接管'
      );

      resetPlayerTimer_(
        roomData,
        target.id
      );
    } else if (
      interaction &&
      rules.timeoutMode === 'skip'
    ) {
      addLog_(
        roomData,
        target.name,
        '思考時間到，自動略過目前互動'
      );

      completeCurrentInteraction_(roomData);

      runEffectEngine_(
        roomData,
        'timeout-skip-interaction'
      );
    } else if (
      roomData.phase === 'action'
    ) {
      target.actionFinished = true;

      addLog_(
        roomData,
        target.name,
        '思考時間到，自動完成行動階段'
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
        enterSimultaneousBuyPhase_(
          roomData
        );
      }
    } else if (
      roomData.phase === 'buy'
    ) {
      target.buyFinished = true;

      addLog_(
        roomData,
        target.name,
        '思考時間到，自動完成購買'
      );

      if (
        roomData.players.every(function(player) {
          return player.buyFinished;
        })
      ) {
        cleanupAllPlayers_(roomData);
        startNextRound_(roomData);
      }
    } else if (interaction) {
      autoResolveTimedOutInteraction_(
        roomData,
        target,
        '思考時間到，自動處理目前互動'
      );
    }

    resetCurrentTimer_(roomData);
    saveRoomContext_(context);

    return {
      success:true,
      processed:true,
      aiControlled:
        Boolean(target.aiControlled),
      message:'已處理超時'
    };
  });
}


function enableAiControl(
  roomNumber,
  playerId,
  aiMode
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

    if (player.isAi) {
      throw new Error('這本來就是 AI 玩家。');
    }

    if (roomData.status !== '遊戲中') {
      throw new Error('遊戲尚未進行。');
    }

    aiMode =
      cleanText(aiMode).toLowerCase();

    if (
      [
        'conservative',
        'balanced',
        'aggressive'
      ].indexOf(aiMode) === -1
    ) {
      aiMode = 'balanced';
    }

    player.aiControlled = true;
    player.manualAiControl = true;
    player.aiControlMode = aiMode;
    player.timerDeadlineAt = '';

    if (!player.aiDifficulty) {
      player.aiDifficulty = 'hard';
    }

    addLog_(
      roomData,
      player.name,
      '主動交由 AI 接管（' +
        getAiControlModeName_(aiMode) +
        '）'
    );

    saveRoomContext_(context);

    return {
      success:true,
      message:'已交由 AI 接管'
    };
  });
}

function getAiControlModeName_(mode) {
  const names = {
    conservative:'保守',
    balanced:'平衡',
    aggressive:'積極'
  };

  return names[mode] || '平衡';
}


function reconnectAndReclaimControl(
  roomNumber,
  playerId
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(
        roomNumber,
        true
      );

    if (!context) {
      throw new Error('房間不存在。');
    }

    const roomData =
      context.roomData;

    const player =
      findPlayer_(
        roomData,
        playerId
      );

    if (!player) {
      throw new Error(
        '你不是這個房間原本的玩家。'
      );
    }

    if (player.isAi) {
      throw new Error(
        'AI 玩家不能恢復真人控制。'
      );
    }

    const wasDisconnected =
      player.connected === false;

    const wasAiControlled =
      player.aiControlled === true;

    const keepManualAi =
      wasAiControlled &&
      player.manualAiControl === true;

    player.connected = true;
    player.lastSeenAt =
      new Date().toISOString();

    if (!keepManualAi) {
      player.aiControlled = false;
      player.manualAiControl = false;
      player.aiControlMode = '';

      if (
        roomData.status === '遊戲中' &&
        isCurrentDecisionPlayer_(
          roomData,
          player.id
        )
      ) {
        resetPlayerTimer_(
          roomData,
          player.id
        );
      }
    }

    if (wasDisconnected) {
      addLog_(
        roomData,
        player.name,
        keepManualAi
          ? '重新連線，維持手動 AI 接管'
          : '重新連線並恢復真人控制'
      );
    }

    saveRoomContext_(context);

    return {
      success:true,
      reclaimed:!keepManualAi,
      manualAiControl:keepManualAi,
      message:
        keepManualAi
          ? '已重新連線，AI 將持續接管，直到你按下恢復真人控制'
          : '已重新連線並恢復真人控制'
    };
  });
}

function reclaimPlayerControl(
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

    if (player.isAi) {
      throw new Error('AI 玩家不能改為真人控制。');
    }

    player.aiControlled = false;
    player.manualAiControl = false;
    player.aiControlMode = '';

    addLog_(
      roomData,
      player.name,
      '已恢復真人控制'
    );

    resetPlayerTimer_(
      roomData,
      player.id
    );

    saveRoomContext_(context);

    return {
      success:true,
      message:'已恢復真人控制'
    };
  });
}

function setRoomTimerPaused(
  roomNumber,
  playerId,
  paused
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData =
      context.roomData;

    const player =
      findPlayer_(roomData, playerId);

    if (!player || !player.isHost) {
      throw new Error('只有房主可以暫停或恢復遊戲。');
    }

    roomData.timerPaused =
      Boolean(paused);

    addLog_(
      roomData,
      player.name,
      roomData.timerPaused
        ? '暫停計時'
        : '恢復計時'
    );

    if (!roomData.timerPaused) {
      resetCurrentTimer_(roomData);
    }

    saveRoomContext_(context);

    return {
      success:true,
      paused:roomData.timerPaused,
      message:
        roomData.timerPaused
          ? '遊戲計時已暫停'
          : '遊戲計時已恢復'
    };
  });
}

function addAiPlayer(
  roomNumber,
  playerId,
  difficulty
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData = context.roomData;
    const host =
      findPlayer_(roomData, playerId);

    if (!host || !host.isHost) {
      throw new Error('只有房主可以加入 AI 玩家。');
    }

    if (roomData.status !== '等待玩家') {
      throw new Error('遊戲開始後不能再加入 AI。');
    }

    if (
      roomData.players.length >=
      roomData.maxPlayers
    ) {
      throw new Error('房間已經滿員。');
    }

    difficulty =
      cleanText(difficulty).toLowerCase();

    if (
      ['easy', 'normal', 'hard']
        .indexOf(difficulty) === -1
    ) {
      difficulty = 'normal';
    }

    const aiCount =
      roomData.players.filter(function(player) {
        return player.isAi;
      }).length + 1;

    const names = {
      easy:'簡單 AI',
      normal:'普通 AI',
      hard:'高手 AI'
    };

    const aiPlayer =
      createPlayerRecord_(
        'ai-' + Utilities.getUuid(),
        names[difficulty] + ' ' + aiCount,
        false,
        true,
        difficulty
      );

    roomData.players.push(aiPlayer);

    saveRoomContext_(context);

    return {
      success:true,
      message:aiPlayer.name + ' 已加入'
    };
  });
}

function removeAiPlayer(
  roomNumber,
  playerId,
  aiPlayerId
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(roomNumber);

    const roomData = context.roomData;
    const host =
      findPlayer_(roomData, playerId);

    if (!host || !host.isHost) {
      throw new Error('只有房主可以移除 AI 玩家。');
    }

    if (roomData.status !== '等待玩家') {
      throw new Error('遊戲開始後不能移除 AI。');
    }

    const index =
      roomData.players.findIndex(function(player) {
        return (
          player.id === aiPlayerId &&
          player.isAi
        );
      });

    if (index === -1) {
      throw new Error('找不到這位 AI 玩家。');
    }

    const removed =
      roomData.players.splice(index, 1)[0];

    saveRoomContext_(context);

    return {
      success:true,
      message:removed.name + ' 已移除'
    };
  });
}

function getRoomState(roomNumber, playerId) {
  const context = loadRoomContext_(roomNumber, true);

  if (!context) {
    return {
      success:false,
      roomExists:false,
      message:'房間不存在'
    };
  }

  const roomData = context.roomData;
  const player = findPlayer_(roomData, playerId);

  return {
    success:true,
    roomExists:true,
    roomNumber:roomData.roomNumber,
    status:roomData.status,
    maxPlayers:roomData.maxPlayers,
    playerCount:roomData.players.length,
    playerRole:
      player && player.isHost
        ? 'host'
        : player
          ? 'player'
          : '',
    players:roomData.players.map(function(item, index) {
      return {
        id:item.id,
        name:item.name,
        isHost:item.isHost,
        seat:index + 1,
        connected:item.connected !== false
      };
    }),
    canStart:
      Boolean(player && player.isHost) &&
      roomData.players.length === roomData.maxPlayers &&
      roomData.status === '等待玩家',
    version:context.version
  };
}

function startGame(roomNumber, playerId) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber);
    const roomData = context.roomData;
    const player = findPlayer_(roomData, playerId);

    if (!player || !player.isHost) {
      throw new Error('只有房主可以開始遊戲。');
    }

    if (
      roomData.players.length !==
      roomData.maxPlayers
    ) {
      throw new Error('必須等所有玩家加入後才能開始。');
    }

    initializeMultiplayerGame_(roomData);
    saveRoomContext_(context);

    return {
      success:true,
      message:'遊戲開始'
    };
  });
}

function leaveRoom(roomNumber, playerId) {
  return withRoomLock_(function() {
    const context = loadRoomContext_(roomNumber, true);

    if (!context) {
      return {success:true};
    }

    const roomData = context.roomData;
    const index = roomData.players.findIndex(function(player) {
      return player.id === playerId;
    });

    if (index === -1) {
      return {success:true};
    }

    const leavingPlayer = roomData.players[index];

    if (roomData.status === '等待玩家') {
      if (leavingPlayer.isHost) {
        const deleteSheet =
          context.sheet ||
          getRoomSheet();

        deleteSheet.deleteRow(
          context.row
        );

        removeCachedRoomContext_(
          roomNumber
        );
        return {
          success:true,
          roomDeleted:true
        };
      }

      /*
       * V19.0.1：
       * 等待室中按離開，不立即刪除玩家紀錄。
       * 這樣同一瀏覽器輸入原房號時，可以回到原座位。
       */
      leavingPlayer.connected = false;
      leavingPlayer.lastSeenAt =
        new Date().toISOString();

      saveRoomContext_(context);

      return {
        success:true,
        disconnected:true,
        seatPreserved:true
      };
    }

    leavingPlayer.connected = false;
    leavingPlayer.lastSeenAt = new Date().toISOString();

    addLog_(
      roomData,
      leavingPlayer.name,
      '暫時離線，遊戲資料已保留'
    );

    saveRoomContext_(context);

    return {
      success:true,
      disconnected:true,
      statePreserved:true
    };
  });
}

function createWaitingRoomData_(
  roomNumber,
  maxPlayers,
  playerId,
  playerName,
  kingdomSelection,
  timerRules
) {
  return {
    roomNumber:roomNumber,
    status:'等待玩家',
    maxPlayers:maxPlayers,
    players:[
      createPlayerRecord_(
        playerId,
        playerName,
        true
      )
    ],
    phase:'waiting',
    actionIndex:0,
    roundNumber:0,
    supply:{},
    interactionQueue:[],
    log:[],
    result:null,
    kingdomMode:
      kingdomSelection.mode,
    kingdomCardIds:
      kingdomSelection.cardIds,
    emptyPileLimit:
      kingdomSelection.emptyPileLimit,
    timerRules:timerRules,
    timerPaused:false,
    timerSequence:0,
    cardSetVersion:CARD_SET_VERSION
  };
}

function createPlayerRecord_(
  playerId,
  playerName,
  isHost,
  isAi,
  aiDifficulty
) {
  return {
    id:playerId,
    name:playerName,
    isHost:Boolean(isHost),
    isAi:Boolean(isAi),
    aiDifficulty:aiDifficulty || '',
    connected:true,
    lastSeenAt:new Date().toISOString(),
    actionFinished:false,
    buyFinished:false,
    aiControlled:false,
    timerDeadlineAt:'',
    state:null
  };
}

function getGameSpreadsheet_() {
  const properties =
    PropertiesService.getScriptProperties();

  const spreadsheetId =
    properties.getProperty(
      'GAME_SPREADSHEET_ID'
    );

  if (spreadsheetId) {
    return SpreadsheetApp.openById(
      spreadsheetId
    );
  }

  const activeSpreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!activeSpreadsheet) {
    throw new Error(
      '尚未設定遊戲資料庫。請先在 Apps Script 編輯器執行 initializeSheets()。'
    );
  }

  properties.setProperty(
    'GAME_SPREADSHEET_ID',
    activeSpreadsheet.getId()
  );

  return activeSpreadsheet;
}

function getRoomSheet() {
  const sheet =
    getGameSpreadsheet_()
      .getSheetByName(ROOM_SHEET_NAME);

  if (!sheet) {
    throw new Error('找不到遊戲房間工作表。');
  }

  return sheet;
}


const ROOM_CONTEXT_CACHE_TTL_SECONDS = 120;
const ROOM_ROW_CACHE_TTL_SECONDS = 600;
const ROOM_CACHE_MAX_TEXT_LENGTH = 90000;

function getRoomCache_() {
  return CacheService.getScriptCache();
}

function roomContextCacheKey_(roomNumber) {
  return 'v21:room:' + roomNumber;
}

function roomRowCacheKey_(roomNumber) {
  return 'v21:row:' + roomNumber;
}

function readCachedRoomContext_(roomNumber) {
  try {
    const text =
      getRoomCache_().get(
        roomContextCacheKey_(roomNumber)
      );

    if (!text) return null;

    const cached = JSON.parse(text);

    if (
      !cached ||
      !cached.roomData ||
      Number(cached.row || 0) < 2
    ) {
      return null;
    }

    return {
      sheet:null,
      row:Number(cached.row),
      version:Number(cached.version || 1),
      roomData:cached.roomData,
      cacheHit:true
    };
  } catch (error) {
    return null;
  }
}

function writeCachedRoomContext_(context) {
  try {
    if (
      !context ||
      !context.roomData ||
      !context.roomData.roomNumber
    ) {
      return;
    }

    const roomNumber =
      cleanRoomNumber(
        context.roomData.roomNumber
      );

    if (!roomNumber) return;

    const text =
      JSON.stringify({
        row:Number(context.row),
        version:Number(context.version || 1),
        roomData:context.roomData
      });

    if (
      text.length >
      ROOM_CACHE_MAX_TEXT_LENGTH
    ) {
      return;
    }

    const cache = getRoomCache_();

    cache.put(
      roomContextCacheKey_(roomNumber),
      text,
      ROOM_CONTEXT_CACHE_TTL_SECONDS
    );

    cache.put(
      roomRowCacheKey_(roomNumber),
      String(context.row),
      ROOM_ROW_CACHE_TTL_SECONDS
    );
  } catch (error) {
    // Cache failure must never stop the game.
  }
}

function removeCachedRoomContext_(roomNumber) {
  roomNumber =
    cleanRoomNumber(roomNumber);

  if (!roomNumber) return;

  const cache = getRoomCache_();

  cache.remove(
    roomContextCacheKey_(roomNumber)
  );

  cache.remove(
    roomRowCacheKey_(roomNumber)
  );
}

function loadRoomFromKnownRow_(
  sheet,
  roomNumber,
  row
) {
  row = Number(row || 0);

  if (
    row < 2 ||
    row > sheet.getLastRow()
  ) {
    return null;
  }

  const values =
    sheet
      .getRange(
        row,
        1,
        1,
        ROOM_COLUMNS
      )
      .getValues()[0];

  const displayedRoomNumber =
    sheet
      .getRange(row, 1)
      .getDisplayValue();

  const currentRoomNumber =
    String(
      displayedRoomNumber ||
      values[0] ||
      ''
    )
      .replace(/\D/g, '')
      .padStart(4, '0')
      .slice(-4);

  if (
    currentRoomNumber !==
    roomNumber
  ) {
    return null;
  }

  const roomData =
    decodeRoomDataChunks_(values);

  roomData.roomNumber =
    roomData.roomNumber ||
    currentRoomNumber;

  return {
    sheet:sheet,
    row:row,
    version:Number(values[5] || 1),
    roomData:roomData,
    cacheHit:false
  };
}

function loadRoomContext_(
  roomNumber,
  allowMissing
) {
  roomNumber =
    cleanRoomNumber(roomNumber);

  if (!roomNumber) {
    if (allowMissing) return null;
    throw new Error(
      '請輸入正確的四位數房號。'
    );
  }

  const cached =
    readCachedRoomContext_(
      roomNumber
    );

  if (cached) {
    return cached;
  }

  const sheet = getRoomSheet();
  const cache = getRoomCache_();

  const cachedRow =
    cache.get(
      roomRowCacheKey_(
        roomNumber
      )
    );

  if (cachedRow) {
    const knownRowContext =
      loadRoomFromKnownRow_(
        sheet,
        roomNumber,
        cachedRow
      );

    if (knownRowContext) {
      writeCachedRoomContext_(
        knownRowContext
      );

      return knownRowContext;
    }

    cache.remove(
      roomRowCacheKey_(
        roomNumber
      )
    );
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    if (allowMissing) return null;
    throw new Error('找不到房間。');
  }

  const values =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        ROOM_COLUMNS
      )
      .getValues();

  const displayedRoomNumbers =
    sheet
      .getRange(
        2,
        1,
        lastRow - 1,
        1
      )
      .getDisplayValues();

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    const currentRoomNumber =
      String(
        displayedRoomNumbers[i][0] ||
        values[i][0] ||
        ''
      )
        .replace(/\D/g, '')
        .padStart(4, '0')
        .slice(-4);

    if (
      currentRoomNumber ===
      roomNumber
    ) {
      const roomData =
        decodeRoomDataChunks_(
          values[i]
        );

      roomData.roomNumber =
        roomData.roomNumber ||
        currentRoomNumber;

      const context = {
        sheet:sheet,
        row:i + 2,
        version:
          Number(
            values[i][5] || 1
          ),
        roomData:roomData,
        cacheHit:false
      };

      writeCachedRoomContext_(
        context
      );

      return context;
    }
  }

  if (allowMissing) return null;
  throw new Error('找不到房間。');
}

function saveRoomContext_(context) {
  context.version =
    Number(context.version || 0) + 1;

  const sheet =
    context.sheet ||
    getRoomSheet();

  context.sheet = sheet;

  compactRoomDataForStorage_(
    context.roomData
  );

  const chunks =
    encodeRoomDataChunks_(
      context.roomData
    );

  sheet
    .getRange(
      context.row,
      2,
      1,
      ROOM_COLUMNS - 1
    )
    .setValues([[
      context.roomData.status,
      context.roomData.maxPlayers,
      chunks[0] || '',
      new Date(),
      context.version,
      chunks[1] || '',
      chunks[2] || '',
      chunks[3] || '',
      chunks[4] || '',
      chunks[5] || '',
      chunks[6] || '',
      chunks[7] || '',
      chunks[8] || '',
      chunks[9] || ''
    ]]);

  writeCachedRoomContext_(context);
}

function compactRoomDataForStorage_(
  roomData
) {
  if (!roomData) return;

  cleanupCompletedEngineState_(roomData);

  if (Array.isArray(roomData.log)) {
    roomData.log =
      roomData.log.slice(-80);
  }

  if (Array.isArray(roomData.engineEvents)) {
    roomData.engineEvents =
      roomData.engineEvents.slice(-80);
  }

  if (Array.isArray(roomData.safeCompleteLog)) {
    roomData.safeCompleteLog = roomData.safeCompleteLog.slice(-80);
  }

  if (Array.isArray(roomData.players)) {
    roomData.players.forEach(function(player) {
      if (!player) return;

      if (
        player.lastAiPurchaseAnalysis &&
        Array.isArray(
          player.lastAiPurchaseAnalysis
            .candidates
        )
      ) {
        player.lastAiPurchaseAnalysis
          .candidates =
            player.lastAiPurchaseAnalysis
              .candidates.slice(0, 5);
      }

      if (
        player.lastAiActionAnalysis &&
        Array.isArray(
          player.lastAiActionAnalysis
            .candidates
        )
      ) {
        player.lastAiActionAnalysis
          .candidates =
            player.lastAiActionAnalysis
              .candidates.slice(0, 5);
      }
    });
  }
}

function buildRoomSheetRow_(
  roomNumber,
  status,
  maxPlayers,
  chunks,
  updatedAt,
  version
) {
  chunks = chunks || [];

  return [
    roomNumber,
    status,
    maxPlayers,
    chunks[0] || '',
    updatedAt,
    version,
    chunks[1] || '',
    chunks[2] || '',
    chunks[3] || '',
    chunks[4] || '',
    chunks[5] || '',
    chunks[6] || '',
    chunks[7] || '',
    chunks[8] || '',
    chunks[9] || ''
  ];
}

function encodeRoomDataChunks_(data) {
  const text = JSON.stringify(data);
  const chunks = [];

  for (
    let offset = 0;
    offset < text.length;
    offset += ROOM_JSON_CHUNK_SIZE
  ) {
    chunks.push(
      text.slice(
        offset,
        offset + ROOM_JSON_CHUNK_SIZE
      )
    );
  }

  if (
    chunks.length >
    ROOM_JSON_CHUNK_COUNT
  ) {
    throw new Error(
      '房間資料已超過 ' +
      (
        ROOM_JSON_CHUNK_SIZE *
        ROOM_JSON_CHUNK_COUNT
      ) +
      ' 字元，請重新建立房間。'
    );
  }

  while (
    chunks.length <
    ROOM_JSON_CHUNK_COUNT
  ) {
    chunks.push('');
  }

  return chunks;
}

function decodeRoomDataChunks_(rowValues) {
  rowValues = rowValues || [];

  const chunkIndexes = [
    3,6,7,8,9,10,11,12,13,14
  ];

  const text =
    chunkIndexes
      .map(function(index) {
        return String(
          rowValues[index] || ''
        );
      })
      .join('');

  return decodeRoomData_(text);
}

function encodeRoomData_(data) {
  return JSON.stringify(data);
}

function decodeRoomData_(value) {
  try {
    return JSON.parse(
      String(value || '{}')
    );
  } catch (error) {
    throw new Error(
      '房間資料損壞或分段資料不完整。'
    );
  }
}



function repairRoomManually(
  roomNumber,
  playerId
) {
  return withRoomLock_(function() {
    const context =
      loadRoomContext_(
        roomNumber
      );

    const roomData =
      context.roomData;

    const player =
      findPlayer_(
        roomData,
        playerId
      );

    if (!player) {
      throw new Error(
        '找不到目前玩家。'
      );
    }

    const result =
      repairRoomState_(
        roomData,
        'manual-repair'
      );

    resetCurrentTimer_(
      roomData
    );

    saveRoomContext_(
      context
    );

    return {
      success:true,
      repaired:result.repaired,
      message:
        result.repaired
          ? (
              '房間修復完成：' +
              result.notes.join('、')
            )
          : '房間狀態正常，無需修復。',
      state:getClientState(
        roomNumber,
        playerId
      )
    };
  });
}

function findPlayer_(roomData, playerId) {
  return roomData.players.find(function(player) {
    return player.id === playerId;
  }) || null;
}


function generateUniqueRoomNumber(sheet) {
  const existingRooms = new Set();
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1)
      .getDisplayValues()
      .forEach(function(row) {
        existingRooms.add(
          String(row[0]).padStart(4, '0')
        );
      });
  }

  for (let i = 0; i < 100; i++) {
    const roomNumber =
      String(
        Math.floor(
          1000 + Math.random() * 9000
        )
      );

    if (!existingRooms.has(roomNumber)) {
      return roomNumber;
    }
  }

  throw new Error('暫時無法產生房號。');
}

function cleanPlayerName(value) {
  return cleanText(value)
    .replace(/[<>]/g, '')
    .substring(0, 12);
}

function cleanRoomNumber(value) {
  const roomNumber =
    String(value || '')
      .replace(/\D/g, '')
      .substring(0, 4);

  return roomNumber.length === 4
    ? roomNumber
    : '';
}

function cleanText(value) {
  return String(value || '').trim();
}

function withRoomLock_(callback) {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(4500)) {
    throw new Error(
      'BUSY:伺服器正在處理其他玩家的操作。'
    );
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}
