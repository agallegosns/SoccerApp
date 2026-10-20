import { strToU8, zipSync } from 'fflate';

/** Construye un .xlsx mínimo (inline strings) para probar el lector. `null` deja la celda vacía. */
export function buildXlsx(rows: readonly (readonly (string | number | null)[])[], options: { sharedStrings?: boolean } = {}): Uint8Array {
  const col = (i: number): string => String.fromCharCode(65 + i);
  const shared: string[] = [];
  const cells = rows.map((row, r) =>
    `<row r="${String(r + 1)}">${row
      .map((value, c) => {
        if (value === null) return '';
        const ref = `${col(c)}${String(r + 1)}`;
        if (typeof value === 'number') return `<c r="${ref}"><v>${String(value)}</v></c>`;
        const esc = value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        if (options.sharedStrings === true) {
          shared.push(esc);
          return `<c r="${ref}" t="s"><v>${String(shared.length - 1)}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc}</t></is></c>`;
      })
      .join('')}</row>`,
  );
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hoja 1" sheetId="1" r:id="rId7"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/data.xml"/></Relationships>'),
    'xl/worksheets/data.xml': strToU8(`<worksheet><sheetData>${cells.join('')}</sheetData></worksheet>`),
  };
  if (options.sharedStrings === true) {
    files['xl/sharedStrings.xml'] = strToU8(`<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`);
  }
  return zipSync(files);
}
