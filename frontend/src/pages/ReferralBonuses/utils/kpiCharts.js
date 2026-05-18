/**
 * Native OOXML chart injection into XLSX buffers.
 *
 * ExcelJS has no chart API, but XLSX is a ZIP of XML files.
 * We write workbook data with ExcelJS, then use JSZip to inject:
 *   xl/charts/chartN.xml        – chart definition (bar / doughnut)
 *   xl/drawings/drawingN.xml    – positions charts on the sheet
 *   xl/drawings/_rels/drawingN.xml.rels
 *   xl/worksheets/_rels/sheetN.xml.rels  (links sheet → drawing)
 * and patch [Content_Types].xml + sheet XML.
 *
 * Chart spec shape:
 * {
 *   type:         'bar' | 'doughnut',
 *   sheetName:    string,          // data lives in this sheet (same sheet)
 *   catCol:       string,          // column letter for labels  ('A', 'B', …)
 *   valCol:       string,          // column letter for values
 *   fromRow:      number,          // 1-indexed first data row (after header)
 *   toRow:        number,          // 1-indexed last data row
 *   isHorizontal: boolean,         // bar charts only
 *   colors:       string[],        // optional per-segment hex colors '#RRGGBB'
 *   numFmt:       string,          // optional value axis format, e.g. '#,##0'
 *   position: { fromCol, fromRow, toCol, toRow }  // 0-indexed anchor cells
 * }
 */

import JSZip from 'jszip';

// ── Content-type / relationship constants ─────────────────────────────────────
const CT_CHART   = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';
const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawingml.spreadsheetDrawing+xml';
const RT_CHART   = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';
const RT_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const NS_R       = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG     = 'http://schemas.openxmlformats.org/package/2006/relationships';

// ── Helpers ───────────────────────────────────────────────────────────────────
function sheetRef(name, col, fromRow, toRow) {
  const n = name.replace(/'/g, "''");
  return `'${n}'!$${col}$${fromRow}:$${col}$${toRow}`;
}

function toArgb(hex) {
  return 'FF' + hex.replace('#', '').toUpperCase().padStart(6, '0');
}

// Extract highest rId number from a relationships XML string
function maxRIdN(xml) {
  const ns = [...(xml || '').matchAll(/Id="rId(\d+)"/g)].map(m => +m[1]);
  return ns.length ? Math.max(...ns) : 0;
}

// ── Bar chart XML ─────────────────────────────────────────────────────────────
function barChartXml(spec) {
  const { sheetName, catCol, valCol, fromRow, toRow,
          isHorizontal = true, colors, numFmt = '#,##0' } = spec;

  const catRange = sheetRef(sheetName, catCol, fromRow, toRow);
  const valRange = sheetRef(sheetName, valCol, fromRow, toRow);

  const dptXml = colors?.length
    ? colors.slice(0, toRow - fromRow + 1).map((c, i) => `
        <c:dPt>
          <c:idx val="${i}"/>
          <c:invertIfNegative val="0"/>
          <c:spPr>
            <a:solidFill><a:srgbClr val="${toArgb(c).slice(2)}"/></a:solidFill>
            <a:ln><a:noFill/></a:ln>
          </c:spPr>
        </c:dPt>`).join('')
    : '';

  const barDir = isHorizontal ? 'bar' : 'col';
  const catPos = isHorizontal ? 'l'   : 'b';
  const valPos = isHorizontal ? 'b'   : 'l';
  const catOri = isHorizontal ? 'maxMin' : 'minMax';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="${barDir}"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="${colors?.length ? 1 : 0}"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:invertIfNegative val="0"/>
          ${dptXml}
          <c:cat><c:strRef><c:f>${catRange}</c:f></c:strRef></c:cat>
          <c:val>
            <c:numRef>
              <c:f>${valRange}</c:f>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:axId val="1"/>
        <c:axId val="2"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="1"/>
        <c:scaling><c:orientation val="${catOri}"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${catPos}"/>
        <c:numFmt formatCode="General" sourceLinked="1"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr><a:ln><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>
        <c:crossAx val="2"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="2"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${valPos}"/>
        <c:numFmt formatCode="${numFmt}" sourceLinked="0"/>
        <c:tickLblPos val="nextTo"/>
        <c:spPr><a:ln><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></c:spPr>
        <c:crossAx val="1"/>
      </c:valAx>
    </c:plotArea>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:spPr>
    <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
    <a:ln><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln>
  </c:spPr>
</c:chartSpace>`;
}

// ── Doughnut chart XML ─────────────────────────────────────────────────────────
function doughnutChartXml(spec) {
  const { sheetName, catCol, valCol, fromRow, toRow, colors } = spec;

  const catRange = sheetRef(sheetName, catCol, fromRow, toRow);
  const valRange = sheetRef(sheetName, valCol, fromRow, toRow);

  const palette = colors?.length ? colors : [
    '#4F8EF7','#10B981','#F59E0B','#EF4444',
    '#8B5CF6','#14B8A6','#F97316','#6366F1',
    '#EC4899','#06B6D4','#84CC16','#A78BFA',
  ];

  const dptXml = Array.from({ length: toRow - fromRow + 1 }, (_, i) => {
    const c = palette[i % palette.length];
    return `
        <c:dPt>
          <c:idx val="${i}"/>
          <c:bubble3D val="0"/>
          <c:spPr>
            <a:solidFill><a:srgbClr val="${toArgb(c).slice(2)}"/></a:solidFill>
            <a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>
          </c:spPr>
        </c:dPt>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:autoTitleDeleted val="1"/>
    <c:plotArea>
      <c:layout/>
      <c:doughnutChart>
        <c:varyColors val="1"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          ${dptXml}
          <c:dLbls>
            <c:spPr/>
            <c:txPr><a:bodyPr/><a:lstStyle/>
              <a:p><a:pPr><a:defRPr sz="900" b="1"/></a:pPr></a:p>
            </c:txPr>
            <c:showLegendKey val="0"/>
            <c:showVal val="0"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="1"/>
            <c:showBubbleSize val="0"/>
          </c:dLbls>
          <c:cat><c:strRef><c:f>${catRange}</c:f></c:strRef></c:cat>
          <c:val><c:numRef><c:f>${valRange}</c:f></c:numRef></c:val>
        </c:ser>
        <c:firstSliceAng val="270"/>
        <c:holeSize val="50"/>
      </c:doughnutChart>
    </c:plotArea>
    <c:legend>
      <c:legendPos val="r"/>
      <c:overlay val="0"/>
    </c:legend>
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
  <c:spPr>
    <a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
    <a:ln><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln>
  </c:spPr>
</c:chartSpace>`;
}

// ── Drawing XML (positions multiple charts on one sheet) ──────────────────────
function drawingXml(entries) {
  // entries: [{ rId, fromCol, fromRow, toCol, toRow, idx }]
  const anchors = entries.map(({ rId, fromCol, fromRow, toCol, toRow, idx }) => `
  <xdr:twoCellAnchor editAs="twoCell">
    <xdr:from>
      <xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:to>
      <xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff>
      <xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff>
    </xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${idx + 2}" name="Chart ${idx + 1}"/>
        <xdr:cNvGraphicFramePr>
          <a:graphicFrameLocks noGrp="1"/>
        </xdr:cNvGraphicFramePr>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                   xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                   r:id="${rId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
${anchors}
</xdr:wsDr>`;
}

// ── Relationships XML ──────────────────────────────────────────────────────────
function relsXml(relationships) {
  const body = relationships.map(r =>
    `  <Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PKG}">
${body}
</Relationships>`;
}

// ── Main injection function ────────────────────────────────────────────────────
/**
 * @param {ArrayBuffer} workbookBuffer  – ExcelJS output buffer
 * @param {Object}      sheetChartMap  – { [sheetName]: ChartSpec[] }
 * @returns {Promise<ArrayBuffer>}      – modified XLSX buffer
 */
export async function injectCharts(workbookBuffer, sheetChartMap) {
  const zip = new JSZip();
  await zip.loadAsync(workbookBuffer);

  // ── Resolve sheet names → file paths ────────────────────────────────────────
  const wbXml    = await zip.file('xl/workbook.xml').async('string');
  const wbRelXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');

  // Build rId → target map from workbook rels
  const relTarget = {};
  for (const m of wbRelXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relTarget[m[1]] = m[2];
  }

  // Build sheetName → worksheet file path
  const sheetFilePath = {}; // e.g. 'Общая' → 'xl/worksheets/sheet1.xml'
  for (const m of wbXml.matchAll(/<sheet\s+([^/]+)\/>/g)) {
    const attrs = m[1];
    const nameM = attrs.match(/name="([^"]+)"/);
    const ridM  = attrs.match(/r:id="([^"]+)"/);
    if (!nameM || !ridM) continue;
    const target = relTarget[ridM[1]];
    if (target) sheetFilePath[nameM[1]] = `xl/${target}`;
  }

  // ── Read + patch [Content_Types].xml ────────────────────────────────────────
  let ctXml = await zip.file('[Content_Types].xml').async('string');

  let globalChartIdx   = 0;
  let globalDrawingIdx = 0;

  // ── Process each sheet ───────────────────────────────────────────────────────
  for (const [sheetName, specs] of Object.entries(sheetChartMap)) {
    if (!specs?.length) continue;
    const wsPath = sheetFilePath[sheetName];
    if (!wsPath) { console.warn('[kpiCharts] sheet not found:', sheetName); continue; }

    const drawingIdx = ++globalDrawingIdx;
    const drawingPath     = `xl/drawings/drawing${drawingIdx}.xml`;
    const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIdx}.xml.rels`;
    const wsFileName      = wsPath.split('/').pop();                     // sheet1.xml
    const wsRelsPath      = `xl/worksheets/_rels/${wsFileName}.rels`;

    // ── Generate chart files and collect drawing entries ─────────────────────
    const drawingEntries = [];
    const drawingRels    = [];

    for (let i = 0; i < specs.length; i++) {
      const spec     = specs[i];
      const chartIdx = ++globalChartIdx;
      const chartPath = `xl/charts/chart${chartIdx}.xml`;
      const chartRId  = `rId${i + 1}`;

      const xml = spec.type === 'doughnut' || spec.type === 'pie'
        ? doughnutChartXml(spec)
        : barChartXml(spec);

      zip.file(chartPath, xml);

      // Content type for this chart
      if (!ctXml.includes(chartPath.replace('xl/', '/xl/'))) {
        ctXml = ctXml.replace(
          '</Types>',
          `  <Override PartName="/${chartPath}" ContentType="${CT_CHART}"/>\n</Types>`
        );
      }

      drawingRels.push({ id: chartRId, type: RT_CHART, target: `../charts/chart${chartIdx}.xml` });
      drawingEntries.push({ rId: chartRId, idx: i, ...spec.position });
    }

    // ── Write drawing files ──────────────────────────────────────────────────
    zip.file(drawingPath,     drawingXml(drawingEntries));
    zip.file(drawingRelsPath, relsXml(drawingRels));

    if (!ctXml.includes(drawingPath.replace('xl/', '/xl/'))) {
      ctXml = ctXml.replace(
        '</Types>',
        `  <Override PartName="/${drawingPath}" ContentType="${CT_DRAWING}"/>\n</Types>`
      );
    }

    // ── Patch worksheet XML to reference drawing ─────────────────────────────
    let wsXml = await zip.file(wsPath).async('string');

    // Ensure xmlns:r is declared (ExcelJS normally includes it, but guard anyway)
    if (!wsXml.includes('xmlns:r=')) {
      wsXml = wsXml.replace(
        '<worksheet ',
        `<worksheet xmlns:r="${NS_R}" `
      );
    }

    // Insert <drawing r:id="..."/> just before </worksheet>
    const drawingRId = 'rId_drw';
    if (!wsXml.includes('<drawing ')) {
      wsXml = wsXml.replace('</worksheet>', `<drawing r:id="${drawingRId}"/></worksheet>`);
    }
    zip.file(wsPath, wsXml);

    // ── Write / extend worksheet rels ─────────────────────────────────────────
    const existingRels = zip.file(wsRelsPath);
    let wsRelsXml;

    if (existingRels) {
      wsRelsXml = await existingRels.async('string');
      const existingN = maxRIdN(wsRelsXml);
      const newId = `rId${existingN + 1}`;
      // Update the drawing rId in the sheet XML to match
      wsXml = wsXml.replace(drawingRId, newId);
      zip.file(wsPath, wsXml);
      wsRelsXml = wsRelsXml.replace(
        '</Relationships>',
        `  <Relationship Id="${newId}" Type="${RT_DRAWING}" Target="../drawings/drawing${drawingIdx}.xml"/>\n</Relationships>`
      );
    } else {
      wsRelsXml = relsXml([{
        id:     drawingRId,
        type:   RT_DRAWING,
        target: `../drawings/drawing${drawingIdx}.xml`,
      }]);
    }

    zip.file(wsRelsPath, wsRelsXml);
  }

  // ── Update content types and repack ──────────────────────────────────────────
  zip.file('[Content_Types].xml', ctXml);

  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 5 },
  });
}
