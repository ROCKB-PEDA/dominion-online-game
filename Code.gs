const ROOM_SHEET_NAME = '遊戲房間';
const ROOM_JSON_CHUNK_SIZE = 45000;
const ROOM_JSON_CHUNK_COUNT = 10;
const ROOM_COLUMNS = 15;

function doGet() {
  initializeSheets();

  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('王國牌庫 V25.2 Safe Complete')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();
}

function initializeSheets() {
  const activeSpreadsheet =
    SpreadsheetApp.getActiveSpreadsheet();

  if (!activeSpreadsheet) {
    throw new Error(
      '找不到綁定的試算表，請從試算表內開啟 Apps Script。'
    );
  }

  /*
   * V15.1：固定記住資料庫試算表 ID。
   * 不論哪位玩家開啟 Web App，都讀寫同一份試算表。
   */
  PropertiesService
    .getScriptProperties()
    .setProperty(
      'GAME_SPREADSHEET_ID',
      activeSpreadsheet.getId()
    );

  const ss = activeSpreadsheet;
  let sheet = ss.getSheetByName(ROOM_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(ROOM_SHEET_NAME);
  }

  sheet.getRange(1, 1, 1, ROOM_COLUMNS).setValues([[
    '房號',
    '遊戲狀態',
    '最大人數',
    '房間資料JSON 1',
    '最後更新時間',
    '版本號',
    '房間資料JSON 2',
    '房間資料JSON 3',
    '房間資料JSON 4',
    '房間資料JSON 5',
    '房間資料JSON 6',
    '房間資料JSON 7',
    '房間資料JSON 8',
    '房間資料JSON 9',
    '房間資料JSON 10'
  ]]);

  sheet.setFrozenRows(1);
  sheet.getRange('A1:O1')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  [
    100,120,90,420,180,90,
    180,180,180,180,180,
    180,180,180,180
  ].forEach(function(width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
}
