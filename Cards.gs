const CARD_SET_VERSION = 'V17';

function getCardTypes_(card) {
  if (!card) return [];

  if (
    Array.isArray(card.types) &&
    card.types.length
  ) {
    return card.types
      .map(function(type) {
        return String(type || '')
          .trim()
          .toLowerCase();
      })
      .filter(Boolean);
  }

  return card.type
    ? [
        String(card.type)
          .trim()
          .toLowerCase()
      ]
    : [];
}

function hasCardType_(card, type) {
  return (
    getCardTypes_(card).indexOf(
      String(type || '')
        .trim()
        .toLowerCase()
    ) !== -1
  );
}

function normalizeCardDefinition_(card) {
  if (!card) return card;

  card.types =
    getCardTypes_(card);

  if (!card.type && card.types.length) {
    card.type = card.types[0];
  }

  return card;
}

function normalizeCardDefinitions_(
  definitions
) {
  Object.keys(definitions || {})
    .forEach(function(cardId) {
      normalizeCardDefinition_(
        definitions[cardId]
      );
    });

  return definitions;
}


function getCardDefinitions() {
  return normalizeCardDefinitions_({
    copper:{
      id:'copper',name:'銅錢',type:'treasure',cssClass:'treasure',
      cost:0,coin:1,victoryPoints:0,description:'+1 金錢',
      baseSupplyCount:46,supplyGroup:10,supplyOrder:10
    },
    silver:{
      id:'silver',name:'銀幣',type:'treasure',cssClass:'treasure',
      cost:3,coin:2,victoryPoints:0,description:'+2 金錢',
      baseSupplyCount:40,supplyGroup:10,supplyOrder:20
    },
    gold:{
      id:'gold',name:'金幣',type:'treasure',cssClass:'treasure',
      cost:6,coin:3,victoryPoints:0,description:'+3 金錢',
      baseSupplyCount:30,supplyGroup:10,supplyOrder:30
    },

    estate:{
      id:'estate',name:'莊園',type:'victory',cssClass:'victory',
      cost:2,victoryPoints:1,description:'1 勝利分',
      baseSupplyCount:8,supplyGroup:20,supplyOrder:10
    },
    duchy:{
      id:'duchy',name:'公國',type:'victory',cssClass:'victory',
      cost:5,victoryPoints:3,description:'3 勝利分',
      baseSupplyCount:8,supplyGroup:20,supplyOrder:20
    },
    province:{
      id:'province',name:'行省',type:'victory',cssClass:'victory',
      cost:8,victoryPoints:6,description:'6 勝利分',
      baseSupplyCount:8,supplyGroup:20,supplyOrder:30
    },
    curse:{
      id:'curse',name:'詛咒',type:'curse',cssClass:'curse',
      cost:0,victoryPoints:-1,description:'-1 勝利分',
      baseSupplyCount:10,supplyGroup:20,supplyOrder:40
    },

    village:{
      id:'village',
      isKingdom:true,name:'村莊',type:'action',cssClass:'action',
      cost:3,victoryPoints:0,description:'+1 張牌、+2 行動',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:10,
      effects:[{type:'draw',amount:1},{type:'actions',amount:2}]
    },
    smithy:{
      id:'smithy',
      isKingdom:true,name:'鐵匠',type:'action',cssClass:'action',
      cost:4,victoryPoints:0,description:'+3 張牌',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:20,
      effects:[{type:'draw',amount:3}]
    },
    market:{
      id:'market',
      isKingdom:true,name:'市集',type:'action',cssClass:'action',
      cost:5,victoryPoints:0,
      description:'+1 張牌、+1 行動、+1 購買、+1 金錢',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:30,
      effects:[
        {type:'draw',amount:1},
        {type:'actions',amount:1},
        {type:'buys',amount:1},
        {type:'coins',amount:1}
      ]
    },
    woodcutter:{
      id:'woodcutter',
      isKingdom:true,name:'伐木工',type:'action',cssClass:'action',
      cost:3,victoryPoints:0,description:'+1 購買、+2 金錢',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:40,
      effects:[{type:'buys',amount:1},{type:'coins',amount:2}]
    },
    laboratory:{
      id:'laboratory',
      isKingdom:true,name:'實驗室',type:'action',cssClass:'action',
      cost:5,victoryPoints:0,description:'+2 張牌、+1 行動',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:50,
      effects:[{type:'draw',amount:2},{type:'actions',amount:1}]
    },
    festival:{
      id:'festival',
      isKingdom:true,name:'節慶',type:'action',cssClass:'action',
      cost:5,victoryPoints:0,description:'+2 行動、+1 購買、+2 金錢',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:60,
      effects:[
        {type:'actions',amount:2},
        {type:'buys',amount:1},
        {type:'coins',amount:2}
      ]
    },
    council_room:{
      id:'council_room',
      isKingdom:true,name:'議事廳',type:'action',cssClass:'action',
      cost:5,victoryPoints:0,
      description:'+4 張牌、+1 購買；其他玩家各抽 1 張牌',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:70,
      effects:[
        {type:'draw',amount:4},
        {type:'buys',amount:1},
        {type:'allOpponentsDraw',amount:1}
      ]
    },
    witch:{
      id:'witch',
      isKingdom:true,name:'女巫',type:'action',cssClass:'attack',
      cost:5,victoryPoints:0,
      description:'+2 張牌；其他玩家各獲得 1 張詛咒',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:80,
      effects:[
        {type:'draw',amount:2},
        {
          type:'attackAllOpponentsGain',
          cardId:'curse',
          destination:'discard'
        }
      ]
    },
    militia:{
      id:'militia',
      isKingdom:true,name:'民兵',type:'action',cssClass:'attack',
      cost:4,victoryPoints:0,
      description:'+2 金錢；其他玩家各棄牌直到手牌剩 3 張',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:90,
      effects:[
        {type:'coins',amount:2},
        {type:'allOpponentsDiscardTo',handSize:3}
      ]
    },
    moat:{
      id:'moat',
      isKingdom:true,name:'護城河',
      type:'action',
      types:['action','reaction'],
      cssClass:'reaction',
      reaction:'attack',cost:2,victoryPoints:0,
      description:'+2 張牌；受到攻擊時可展示，免疫該次攻擊',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:100,
      effects:[{type:'draw',amount:2}]
    },
    workshop:{
      id:'workshop',
      isKingdom:true,name:'工坊',type:'action',cssClass:'action',
      cost:3,victoryPoints:0,description:'獲得一張費用最高 4 的卡',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:110,
      effects:[{type:'selectSupplyGain',maxCost:4,destination:'discard'}]
    },
    chapel:{
      id:'chapel',
      isKingdom:true,name:'禮拜堂',type:'action',cssClass:'action',
      cost:2,victoryPoints:0,description:'最多移除手牌中的 4 張牌',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:120,
      effects:[{type:'selectHandTrash',min:0,max:4}]
    },
    cellar:{
      id:'cellar',
      isKingdom:true,name:'地下儲藏室',type:'action',cssClass:'action',
      cost:2,victoryPoints:0,
      description:'+1 行動；棄掉任意張手牌，再抽相同張數',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:130,
      effects:[
        {type:'actions',amount:1},
        {type:'selectHandDiscardDraw',min:0}
      ]
    },
    remodel:{
      id:'remodel',
      isKingdom:true,name:'改建',type:'action',cssClass:'action',
      cost:4,victoryPoints:0,
      description:'移除一張手牌，再獲得一張費用最多高 2 的卡',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:140,
      effects:[
        {
          type:'selectHandTrashThenGain',
          min:1,max:1,costBonus:2,destination:'discard'
        }
      ]
    },
    mine:{
      id:'mine',
      isKingdom:true,name:'礦坑',type:'action',cssClass:'action',
      cost:5,victoryPoints:0,
      description:'移除一張寶物牌，再獲得費用最多高 3 的寶物牌到手牌',
      baseSupplyCount:10,supplyGroup:30,supplyOrder:150,
      effects:[
        {
          type:'selectTreasureTrashThenGain',
          min:1,max:1,costBonus:3,destination:'hand'
        }
      ]
    }
,

    bureaucrat:{
      id:'bureaucrat',
      isKingdom:true,
      name:'官員',
      type:'action',
      cssClass:'attack',
      cost:4,
      victoryPoints:0,
      description:'獲得一張銀幣到牌庫頂；其他玩家將一張勝利卡放到牌庫頂',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:160,
      effects:[{type:'bureaucrat'}]
    },

    chancellor:{
      id:'chancellor',
      isKingdom:true,
      name:'密探',
      type:'action',
      cssClass:'action',
      cost:3,
      victoryPoints:0,
      description:'+2 金錢；將自己的牌庫放入棄牌堆',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:170,
      effects:[
        {type:'coins',amount:2},
        {type:'discardDeck'}
      ]
    },

    feast:{
      id:'feast',
      isKingdom:true,
      name:'盛宴',
      type:'action',
      cssClass:'action',
      cost:4,
      victoryPoints:0,
      description:'移除這張牌；獲得一張費用最高 5 的卡',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:180,
      effects:[{type:'trashSelfThenGain',maxCost:5,destination:'discard'}]
    },

    gardens:{
      id:'gardens',
      isKingdom:true,
      name:'花園',
      type:'victory',
      cssClass:'victory',
      cost:4,
      victoryPoints:0,
      dynamicVictory:'gardens',
      description:'牌組中每有 10 張牌，獲得 1 勝利分',
      baseSupplyCount:8,
      supplyGroup:30,
      supplyOrder:190
    },

    library:{
      id:'library',
      isKingdom:true,
      name:'圖書館',
      type:'action',
      cssClass:'action',
      cost:5,
      victoryPoints:0,
      description:'抽牌直到手牌有 7 張',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:200,
      effects:[{type:'drawUntilHand',handSize:7}]
    },

    moneylender:{
      id:'moneylender',
      isKingdom:true,
      name:'放債者',
      type:'action',
      cssClass:'action',
      cost:4,
      victoryPoints:0,
      description:'移除手牌中的一張銅錢；若有移除，+3 金錢',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:210,
      effects:[{type:'trashCopperForCoins',amount:3}]
    },

    spy:{
      id:'spy',
      isKingdom:true,
      name:'間諜',
      type:'action',
      cssClass:'attack',
      cost:4,
      victoryPoints:0,
      description:'+1 張牌、+1 行動；查看各玩家牌庫頂並依策略棄掉或保留',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:220,
      effects:[
        {type:'draw',amount:1},
        {type:'actions',amount:1},
        {type:'spyResolve'}
      ]
    },

    thief:{
      id:'thief',
      isKingdom:true,
      name:'小偷',
      type:'action',
      cssClass:'attack',
      cost:4,
      victoryPoints:0,
      description:'其他玩家翻開兩張牌；取得其中價值最高的寶物牌',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:230,
      effects:[{type:'thiefResolve'}]
    },

    throne_room:{
      id:'throne_room',
      isKingdom:true,
      name:'寶座廳',
      type:'action',
      cssClass:'action',
      cost:4,
      victoryPoints:0,
      description:'選擇一張手牌中的行動卡，打出並執行兩次',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:240,
      effects:[{type:'selectActionRepeat',repeatCount:2}]
    },

    adventurer:{
      id:'adventurer',
      isKingdom:true,
      name:'冒險者',
      type:'action',
      cssClass:'action',
      cost:6,
      victoryPoints:0,
      description:'翻牌直到找到兩張寶物牌，寶物加入手牌，其餘牌進棄牌堆',
      baseSupplyCount:10,
      supplyGroup:30,
      supplyOrder:250,
      effects:[{type:'adventurer',treasureCount:2}]
    }
  });
}

function getCardDefinition(cardId) {
  const key = cleanText(cardId).toLowerCase();
  return normalizeCardDefinition_(getCardDefinitions()[key] || null);
}

function getSupplyCount_(card, playerCount) {
  if (card.id === 'curse') {
    return Math.max(10, (playerCount - 1) * 10);
  }

  if (
    card.id === 'estate' ||
    card.id === 'duchy' ||
    card.id === 'province'
  ) {
    if (playerCount <= 2) return 8;
    if (playerCount <= 4) return 12;
    return 3 * playerCount;
  }

  if (
    hasCardType_(card, 'action') ||
    hasCardType_(card, 'treasure')
  ) {
    if (playerCount <= 4) {
      return Number(card.baseSupplyCount || 10);
    }

    return Math.max(
      Number(card.baseSupplyCount || 10),
      Math.ceil(playerCount * 2.5)
    );
  }

  return Number(card.baseSupplyCount || 10);
}

function createSupplyFromCardDefinitions(
  playerCount,
  kingdomCardIds
) {
  const definitions = getCardDefinitions();
  const selectedKingdom =
    new Set(
      Array.isArray(kingdomCardIds)
        ? kingdomCardIds
        : getKingdomCardIds()
    );

  const supply = {};

  Object.keys(definitions).forEach(function(cardId) {
    const card = definitions[cardId];

    if (
      card.isKingdom &&
      !selectedKingdom.has(cardId)
    ) {
      return;
    }

    supply[cardId] =
      getSupplyCount_(card, playerCount);
  });

  return supply;
}

function getPublicCardCatalog() {
  const definitions = getCardDefinitions();
  const catalog = {};

  Object.keys(definitions).forEach(function(cardId) {
    const card = definitions[cardId];

    catalog[cardId] = {
      id:card.id,
      name:card.name,
      type:card.type,
      types:getCardTypes_(card),
      cssClass:card.cssClass || card.type || 'other',
      cost:Number(card.cost || 0),
      coin:Number(card.coin || 0),
      victoryPoints:Number(card.victoryPoints || 0),
      description:card.description || '',
      supplyGroup:Number(card.supplyGroup || 999),
      supplyOrder:Number(card.supplyOrder || 999),
      reaction:card.reaction || '',
      isKingdom:Boolean(card.isKingdom),
      dynamicVictory:card.dynamicVictory || ''
    };
  });

  return catalog;
}


function getKingdomCardIds() {
  const definitions = getCardDefinitions();

  return Object.keys(definitions)
    .filter(function(cardId) {
      return Boolean(definitions[cardId].isKingdom);
    })
    .sort(function(leftId, rightId) {
      return (
        Number(definitions[leftId].supplyOrder || 999) -
        Number(definitions[rightId].supplyOrder || 999)
      );
    });
}

function shuffleIds_(ids) {
  const result = ids.slice();

  for (let i = result.length - 1; i > 0; i--) {
    const index =
      Math.floor(Math.random() * (i + 1));

    const temp = result[i];
    result[i] = result[index];
    result[index] = temp;
  }

  return result;
}

function pickUniqueCards_(pool, count, alreadySelected) {
  const selected =
    Array.isArray(alreadySelected)
      ? alreadySelected.slice()
      : [];

  shuffleIds_(pool).forEach(function(cardId) {
    if (
      selected.length < count &&
      selected.indexOf(cardId) === -1
    ) {
      selected.push(cardId);
    }
  });

  return selected.slice(0, count);
}

function buildKingdomSelection_(
  mode,
  customCardIds
) {
  const all = getKingdomCardIds();
  const definitions = getCardDefinitions();

  mode = cleanText(mode).toLowerCase();

  if (mode === 'all') {
    return {
      mode:'all',
      cardIds:all,
      emptyPileLimit:6
    };
  }

  if (mode === 'custom') {
    const custom =
      Array.from(
        new Set(
          (Array.isArray(customCardIds)
            ? customCardIds
            : []
          ).filter(function(cardId) {
            return all.indexOf(cardId) !== -1;
          })
        )
      );

    if (custom.length !== 10) {
      throw new Error('自訂王國必須剛好選擇 10 張卡。');
    }

    return {
      mode:'custom',
      cardIds:custom,
      emptyPileLimit:3
    };
  }

  const presets = {
    beginner:[
      'village','smithy','market','woodcutter','laboratory',
      'festival','moat','workshop','remodel','mine'
    ],
    attack:[
      'witch','militia','bureaucrat','spy','thief',
      'moat','village','market','laboratory','chapel'
    ],
    engine:[
      'village','laboratory','market','festival','library',
      'council_room','throne_room','smithy','cellar','chapel'
    ],
    money:[
      'smithy','market','festival','mine','moneylender',
      'adventurer','woodcutter','remodel','feast','gardens'
    ]
  };

  if (presets[mode]) {
    return {
      mode:mode,
      cardIds:presets[mode].slice(),
      emptyPileLimit:3
    };
  }

  if (mode === 'balanced') {
    const drawCards = [
      'smithy','laboratory','library','council_room','moat'
    ];
    const actionCards = [
      'village','market','festival','laboratory','spy','cellar'
    ];
    const economyCards = [
      'market','festival','woodcutter','moneylender','mine','adventurer'
    ];
    const deckCards = [
      'chapel','workshop','remodel','mine','feast','moneylender'
    ];
    const attacks = [
      'witch','militia','bureaucrat','spy','thief'
    ];

    let selected = [];
    selected = pickUniqueCards_(drawCards, 1, selected);
    selected = pickUniqueCards_(actionCards, 2, selected);
    selected = pickUniqueCards_(economyCards, 3, selected);
    selected = pickUniqueCards_(deckCards, 4, selected);
    selected = pickUniqueCards_(attacks, 5, selected);
    selected = pickUniqueCards_(all, 10, selected);

    return {
      mode:'balanced',
      cardIds:selected,
      emptyPileLimit:3
    };
  }

  return {
    mode:'random',
    cardIds:shuffleIds_(all).slice(0, 10),
    emptyPileLimit:3
  };
}
