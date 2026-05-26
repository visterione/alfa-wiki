import React from 'react';
import './SpreadsheetGrouping.css';

// Univer internal layout constants (must match Univer's defaults)
export const UNIVER_COL_HEADER_HEIGHT = 20;
export const UNIVER_ROW_HEADER_WIDTH = 46;
export const DEFAULT_ROW_HEIGHT = 24;
export const DEFAULT_COL_WIDTH = 88;
export const GROUP_LEVEL_WIDTH = 20;  // px per nesting level in row group panel
export const GROUP_LEVEL_HEIGHT = 20; // px per nesting level in col group panel
const BTN_SIZE = 14;

// ─── Data helpers ────────────────────────────────────────────────────────────

/**
 * Build group list from XLSX outline-level map { rowIndex: outlineLevel }.
 * Contiguous rows with level >= L form a group at level L.
 */
export function buildGroupsFromOutlineLevels(levels) {
  if (!levels || Object.keys(levels).length === 0) return [];

  const levelNums = Object.values(levels).map(Number).filter(n => n > 0);
  if (levelNums.length === 0) return [];

  const maxLevel = Math.max(...levelNums);
  const indices = Object.keys(levels).map(Number).sort((a, b) => a - b);
  const maxIndex = indices[indices.length - 1];
  const groups = [];

  for (let lv = 1; lv <= maxLevel; lv++) {
    let start = null;
    for (let i = 0; i <= maxIndex + 1; i++) {
      const rowLv = Number(levels[i] ?? 0);
      if (rowLv >= lv) {
        if (start === null) start = i;
      } else {
        if (start !== null) {
          groups.push({ start, end: i - 1, level: lv, collapsed: false });
          start = null;
        }
      }
    }
    if (start !== null) {
      groups.push({ start, end: maxIndex, level: lv, collapsed: false });
    }
  }

  return groups;
}

/**
 * Derive outline-level map from a group list.
 */
export function getOutlineLevelsFromGroups(groups) {
  const levels = {};
  for (const g of groups) {
    for (let i = g.start; i <= g.end; i++) {
      levels[i] = Math.max(levels[i] ?? 0, g.level);
    }
  }
  return levels;
}

/**
 * Find appropriate nesting level for a new group [start..end].
 * Level = 1 + max level of any existing group that STRICTLY contains this range.
 */
export function findNewGroupLevel(existingGroups, start, end) {
  let max = 0;
  for (const g of existingGroups) {
    const strictlyContains = g.start <= start && g.end >= end &&
      !(g.start === start && g.end === end);
    if (strictlyContains) max = Math.max(max, g.level);
  }
  return max + 1;
}

// ─── Pixel-position helpers ───────────────────────────────────────────────────

/** Cumulative pixel height of rows 0..rowIndex-1 (hidden rows contribute 0). */
function pixelTopOfRow(rowIndex, rowData) {
  let top = 0;
  for (let i = 0; i < rowIndex; i++) {
    if (!rowData[i]?.hd) top += rowData[i]?.h || DEFAULT_ROW_HEIGHT;
  }
  return top;
}

/** Pixel Y of row `r` inside the row-bars area (below the level-buttons row). */
function rowToY(r, sheetViewStartRow, offsetY, rowData) {
  return (
    pixelTopOfRow(r, rowData) -
    pixelTopOfRow(sheetViewStartRow, rowData) -
    offsetY
  );
}

/** Height of a single row (0 if hidden). */
function rowH(i, rowData) {
  if (rowData[i]?.hd) return 0;
  return rowData[i]?.h || DEFAULT_ROW_HEIGHT;
}

/** Total visible pixel height of rows start..end (inclusive). */
function groupRowH(start, end, rowData) {
  let h = 0;
  for (let r = start; r <= end; r++) h += rowH(r, rowData);
  return h;
}

/** Cumulative pixel width of cols 0..colIndex-1. */
function pixelLeftOfCol(colIndex, colData) {
  let left = 0;
  for (let i = 0; i < colIndex; i++) {
    if (!colData[i]?.hd) left += colData[i]?.w || DEFAULT_COL_WIDTH;
  }
  return left;
}

/** Pixel X of col `c` inside the col-bars area (to the right of level-buttons column). */
function colToX(c, sheetViewStartColumn, offsetX, colData) {
  return (
    pixelLeftOfCol(c, colData) -
    pixelLeftOfCol(sheetViewStartColumn, colData) -
    offsetX
  );
}

function colW(i, colData) {
  if (colData[i]?.hd) return 0;
  return colData[i]?.w || DEFAULT_COL_WIDTH;
}

function groupColW(start, end, colData) {
  let w = 0;
  for (let c = start; c <= end; c++) w += colW(c, colData);
  return w;
}

// ─── RowGroupPanel ────────────────────────────────────────────────────────────

export function RowGroupPanel({
  groups,
  scrollState,
  rowData,
  panelHeight,
  onToggle,
  onLevelClick,
}) {
  const maxLevel = groups.length > 0 ? Math.max(...groups.map(g => g.level)) : 0;
  if (maxLevel === 0) return null;

  const panelWidth = maxLevel * GROUP_LEVEL_WIDTH;
  const { sheetViewStartRow = 0, offsetY = 0 } = scrollState;
  const barsHeight = panelHeight - UNIVER_COL_HEADER_HEIGHT;

  return (
    <div className="sg-row-panel" style={{ width: panelWidth, height: panelHeight }}>
      {/* Level buttons (aligned with Univer column header) */}
      <div className="sg-level-row" style={{ height: UNIVER_COL_HEADER_HEIGHT }}>
        {Array.from({ length: maxLevel }, (_, i) => i + 1).map(lv => (
          <button
            key={lv}
            className="sg-level-btn"
            onClick={() => onLevelClick(lv, 'row')}
            title={`Свернуть до уровня ${lv}`}
          >
            {lv}
          </button>
        ))}
      </div>

      {/* Group bars */}
      <div className="sg-bars-area" style={{ height: barsHeight }}>
        {groups.map((group, idx) => {
          const topY = rowToY(group.start, sheetViewStartRow, offsetY, rowData);
          const totalH = groupRowH(group.start, group.end, rowData);
          const levelX = (group.level - 1) * GROUP_LEVEL_WIDTH;
          return (
            <RowGroupBar
              key={`rg-${group.start}-${group.end}-${group.level}`}
              group={group}
              topY={topY}
              totalH={totalH}
              levelX={levelX}
              onToggle={() => onToggle(idx)}
            />
          );
        })}
      </div>
    </div>
  );
}

function RowGroupBar({ group, topY, totalH, levelX, onToggle }) {
  const midX = levelX + GROUP_LEVEL_WIDTH / 2;

  if (group.collapsed) {
    return (
      <div
        className="sg-bar-wrap"
        style={{ left: levelX, top: topY, width: GROUP_LEVEL_WIDTH }}
      >
        <button
          className="sg-btn sg-btn-expand"
          style={{
            left: midX - levelX - BTN_SIZE / 2,
            top: -BTN_SIZE / 2,
            width: BTN_SIZE,
            height: BTN_SIZE,
          }}
          onClick={onToggle}
          title="Развернуть группу"
        >
          +
        </button>
        <div
          className="sg-tick-h"
          style={{ top: 0, left: midX - levelX - 4, width: 8 }}
        />
      </div>
    );
  }

  if (totalH <= 0) return null;

  const lineH = Math.max(0, totalH - BTN_SIZE - 2);

  return (
    <div
      className="sg-bar-wrap"
      style={{ left: levelX, top: topY, width: GROUP_LEVEL_WIDTH, height: totalH }}
    >
      <div
        className="sg-line-v"
        style={{ left: midX - levelX, height: lineH }}
      />
      <div
        className="sg-cap-h"
        style={{ top: lineH, left: midX - levelX, width: GROUP_LEVEL_WIDTH / 2 }}
      />
      <button
        className="sg-btn sg-btn-collapse"
        style={{
          left: midX - levelX - BTN_SIZE / 2,
          top: lineH,
          width: BTN_SIZE,
          height: BTN_SIZE,
        }}
        onClick={onToggle}
        title="Свернуть группу"
      >
        −
      </button>
    </div>
  );
}

// ─── ColGroupPanel ────────────────────────────────────────────────────────────

export function ColGroupPanel({
  groups,
  scrollState,
  colData,
  panelWidth,
  onToggle,
  onLevelClick,
}) {
  const maxLevel = groups.length > 0 ? Math.max(...groups.map(g => g.level)) : 0;
  if (maxLevel === 0) return null;

  const panelHeight = maxLevel * GROUP_LEVEL_HEIGHT;
  const { sheetViewStartColumn = 0, offsetX = 0 } = scrollState;

  return (
    <div className="sg-col-panel" style={{ height: panelHeight, width: panelWidth }}>
      {/* Level buttons (aligned with Univer row header) */}
      <div className="sg-level-col" style={{ width: UNIVER_ROW_HEADER_WIDTH }}>
        {Array.from({ length: maxLevel }, (_, i) => i + 1).map(lv => (
          <button
            key={lv}
            className="sg-level-btn"
            onClick={() => onLevelClick(lv, 'col')}
            title={`Свернуть до уровня ${lv}`}
          >
            {lv}
          </button>
        ))}
      </div>

      {/* Group bars (positioned after the row-header area) */}
      <div className="sg-bars-area-h" style={{ left: UNIVER_ROW_HEADER_WIDTH }}>
        {groups.map((group, idx) => {
          const leftX = colToX(group.start, sheetViewStartColumn, offsetX, colData);
          const totalW = groupColW(group.start, group.end, colData);
          const levelY = (group.level - 1) * GROUP_LEVEL_HEIGHT;
          return (
            <ColGroupBar
              key={`cg-${group.start}-${group.end}-${group.level}`}
              group={group}
              leftX={leftX}
              totalW={totalW}
              levelY={levelY}
              onToggle={() => onToggle(idx)}
            />
          );
        })}
      </div>
    </div>
  );
}

function ColGroupBar({ group, leftX, totalW, levelY, onToggle }) {
  const midY = levelY + GROUP_LEVEL_HEIGHT / 2;

  if (group.collapsed) {
    return (
      <div
        className="sg-bar-wrap-h"
        style={{ top: levelY, left: leftX, height: GROUP_LEVEL_HEIGHT }}
      >
        <button
          className="sg-btn sg-btn-expand"
          style={{
            top: midY - levelY - BTN_SIZE / 2,
            left: -BTN_SIZE / 2,
            width: BTN_SIZE,
            height: BTN_SIZE,
          }}
          onClick={onToggle}
          title="Развернуть группу"
        >
          +
        </button>
        <div
          className="sg-tick-v"
          style={{ left: 0, top: midY - levelY - 4, height: 8 }}
        />
      </div>
    );
  }

  if (totalW <= 0) return null;

  const lineW = Math.max(0, totalW - BTN_SIZE - 2);

  return (
    <div
      className="sg-bar-wrap-h"
      style={{ top: levelY, left: leftX, width: totalW, height: GROUP_LEVEL_HEIGHT }}
    >
      <div
        className="sg-line-h"
        style={{ top: midY - levelY, width: lineW }}
      />
      <div
        className="sg-cap-v"
        style={{ left: lineW, top: midY - levelY, height: GROUP_LEVEL_HEIGHT / 2 }}
      />
      <button
        className="sg-btn sg-btn-collapse"
        style={{
          top: midY - levelY - BTN_SIZE / 2,
          left: lineW,
          width: BTN_SIZE,
          height: BTN_SIZE,
        }}
        onClick={onToggle}
        title="Свернуть группу"
      >
        −
      </button>
    </div>
  );
}
