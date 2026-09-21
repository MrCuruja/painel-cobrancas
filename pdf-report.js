/* Monte Verde · demonstrativo individual. Requer PDFLib local (pdf-lib 1.17.1).
 * Não lê o app, não faz requisições e não modifica o relatório recebido.
 */
(function (global) {
  'use strict';

  async function generate(report, options) {
    const lib = global.PDFLib;
    if (!lib || !lib.PDFDocument) throw new Error('O gerador de PDF não foi carregado. Reabra o aplicativo e tente novamente.');
    if (!report || typeof report !== 'object') throw new Error('Não foi possível preparar os dados deste demonstrativo.');

    const { PDFDocument, StandardFonts, rgb } = lib;
    const document = await PDFDocument.create();
    const regular = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    const width = 595.28;
    const height = 841.89;
    const margin = 40;
    const contentWidth = width - margin * 2;
    const bottom = height - 66;
    const palette = {
      ink: rgb(0.12, 0.20, 0.17),
      muted: rgb(0.36, 0.43, 0.40),
      green: rgb(0.08, 0.35, 0.27),
      pale: rgb(0.93, 0.97, 0.94),
      line: rgb(0.82, 0.88, 0.84),
      alternate: rgb(0.975, 0.985, 0.978),
      amber: rgb(0.48, 0.31, 0.06),
      amberBg: rgb(1, 0.965, 0.875),
      white: rgb(1, 1, 1)
    };
    let logo = null;
    if (options && options.logoBytes) {
      try { logo = await document.embedPng(options.logoBytes); }
      catch (_) {
        try { logo = await document.embedJpg(options.logoBytes); }
        catch (_) { /* A marca em texto é suficiente se o arquivo falhar. */ }
      }
    }

    // Helvetica/WinAnsi preserva os acentos portugueses. Outros alfabetos
    // recebem uma alternativa imprimível em vez de interromper a geração.
    const characters = new Map();
    let adaptedCharacters = false;
    function printable(value) {
      let result = '';
      for (const character of String(value == null ? '' : value).normalize('NFC')) {
        if (character === '\n') { result += '\n'; continue; }
        if (character === '\r') continue;
        if (character === '\t' || character === '\u00a0') { result += ' '; continue; }
        const code = character.codePointAt(0);
        if (code < 32 || (code >= 127 && code <= 159) || /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(character)) continue;
        if (!characters.has(character)) {
          let replacement = character;
          try { regular.encodeText(character); }
          catch (_) {
            replacement = character.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
            try { regular.encodeText(replacement); }
            catch (_) { replacement = '?'; }
            if (!replacement) replacement = '?';
            adaptedCharacters = true;
          }
          characters.set(character, replacement);
        }
        result += characters.get(character);
      }
      return result;
    }
    const fontWidth = (text, font, size) => font.widthOfTextAtSize(text, size);
    function wrap(value, available, font, size) {
      const lines = [];
      const paragraphs = printable(value).split('\n');
      for (const paragraph of paragraphs) {
        const words = paragraph.trim().split(/\s+/).filter(Boolean);
        let line = '';
        if (!words.length) { lines.push(''); continue; }
        for (let word of words) {
          const candidate = line ? line + ' ' + word : word;
          if (fontWidth(candidate, font, size) <= available) { line = candidate; continue; }
          if (line) { lines.push(line); line = ''; }
          // Divide também identificadores longos sem espaços. O limite da
          // busca evita medições quadráticas em textos excepcionalmente longos.
          while (word.length > 256 || fontWidth(word, font, size) > available) {
            let low = 1;
            let high = Math.min(word.length, 256);
            let count = 1;
            while (low <= high) {
              const middle = (low + high) >>> 1;
              if (fontWidth(word.slice(0, middle), font, size) <= available) { count = middle; low = middle + 1; }
              else high = middle - 1;
            }
            lines.push(word.slice(0, count));
            word = word.slice(count);
          }
          line = word;
        }
        if (line) lines.push(line);
      }
      return lines.length ? lines : [''];
    }
    function amount(value) {
      const number = Number(value);
      return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(number) ? (Object.is(number, -0) ? 0 : number) : 0);
    }
    function rate(value) {
      const number = Number(value);
      return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(Number.isFinite(number) ? number : 0);
    }
    function date(value) {
      const text = String(value == null ? '' : value);
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      return match ? match[3] + '/' + match[2] + '/' + match[1] : text || '—';
    }

    let page;
    let cursor = 0;
    let inTable = false;
    const pages = [];
    const columnWidths = [124, 64, 64, 75, 55, 55, contentWidth - 437];
    const columnTitles = ['Parcela', 'Vencimento', 'Referência', 'Condomínio', 'Juros', 'Multa', 'Total'];
    function text(value, x, top, size, font, color, align) {
      const content = printable(value);
      if (!content) return;
      const measured = fontWidth(content, font || regular, size);
      page.drawText(content, {
        x: align === 'right' ? x - measured : x,
        y: height - top - size,
        size, font: font || regular, color: color || palette.ink
      });
    }
    function rectangle(x, top, boxWidth, boxHeight, color) {
      page.drawRectangle({ x, y: height - top - boxHeight, width: boxWidth, height: boxHeight, color });
    }
    function rule(top, x, lineWidth, color) {
      page.drawLine({ start: { x: x == null ? margin : x, y: height - top }, end: { x: (x == null ? margin : x) + (lineWidth == null ? contentWidth : lineWidth), y: height - top }, thickness: 0.6, color: color || palette.line });
    }
    function tableHeader() {
      rectangle(margin, cursor, contentWidth, 30, palette.green);
      let x = margin;
      columnTitles.forEach((title, index) => {
        text(title, index >= 3 ? x + columnWidths[index] - 8 : x + 8, cursor + 10, 8.2, bold, palette.white, index >= 3 ? 'right' : 'left');
        x += columnWidths[index];
      });
      cursor += 30;
    }
    function newPage() {
      page = document.addPage([width, height]);
      pages.push(page);
      rectangle(0, 0, width, 5, palette.green);
      const brandX = logo ? margin + 64 : margin;
      if (logo) {
        const dimensions = logo.scaleToFit(52, 52);
        page.drawImage(logo, { x: margin + (52 - dimensions.width) / 2, y: height - 33 - dimensions.height, width: dimensions.width, height: dimensions.height });
      }
      text('Monte Verde', brandX, 38, 17, bold, palette.green);
      text('R E S I D E N C I A L', brandX, 61, 8.3, regular, palette.muted);
      text('Demonstrativo de débitos', margin, 101, pages.length === 1 ? 23 : 18, bold, palette.ink);
      rule(138);
      cursor = 154;
      if (inTable) tableHeader();
    }
    function room(required) {
      if (cursor + required > bottom) newPage();
    }
    function paragraph(value, settings) {
      const config = settings || {};
      const size = config.size || 10;
      const lineHeight = config.lineHeight || size * 1.45;
      const font = config.bold ? bold : regular;
      const lines = wrap(value, config.width || contentWidth, font, size);
      for (const line of lines) {
        room(lineHeight);
        text(line, config.x || margin, cursor, size, font, config.color || palette.ink);
        cursor += lineHeight;
      }
      cursor += config.after || 0;
    }
    function notice(value) {
      const lines = wrap(value, contentWidth - 24, regular, 9);
      let offset = 0;
      while (offset < lines.length) {
        room(38);
        const count = Math.min(lines.length - offset, Math.max(1, Math.floor((bottom - cursor - 20) / 13)));
        const blockHeight = count * 13 + 20;
        rectangle(margin, cursor, contentWidth, blockHeight, palette.amberBg);
        for (let index = 0; index < count; index++) text(lines[offset + index], margin + 12, cursor + 9 + index * 13, 9, regular, palette.amber);
        cursor += blockHeight + 12;
        offset += count;
      }
    }

    newPage();
    paragraph('IDENTIFICAÇÃO', { size: 8, bold: true, color: palette.green, after: 7 });
    paragraph(report.nome || 'Nome não informado', { size: 16, lineHeight: 21, bold: true, after: 5 });
    paragraph('Unidade ' + (report.unidade || 'não informada') + '  •  Quadra ' + (report.quadra || 'não informada'), { size: 10, color: palette.muted, after: 8 });
    paragraph('Emitido em: ' + (report.emitidoEm || 'data não informada'), { size: 9, color: palette.muted, after: 15 });
    if (report.sincronizado !== true) {
      notice('Cópia deste aparelho: a gravação destes dados na nuvem ainda não foi confirmada. Este demonstrativo pode diferir da versão disponível em outros aparelhos.');
    }

    const installments = Array.isArray(report.parcelas) ? report.parcelas : [];
    room(120);
    paragraph('PARCELAS EM ABERTO', { size: 10, bold: true, color: palette.green, after: 4 });
    paragraph(installments.length + (installments.length === 1 ? ' parcela' : ' parcelas') + '  •  Valores em reais (R$)  •  Referência de cálculo indicada em cada linha', { size: 8.2, color: palette.muted, after: 8 });

    if (!installments.length) {
      room(68);
      rectangle(margin, cursor, contentWidth, 60, palette.pale);
      text('Nenhuma parcela em aberto', margin + 16, cursor + 13, 12, bold, palette.green);
      text('Não há valores em aberto neste demonstrativo.', margin + 16, cursor + 34, 9, regular, palette.muted);
      cursor += 77;
    } else {
      inTable = true;
      tableHeader();
      installments.forEach((installment, installmentIndex) => {
        const item = installment && typeof installment === 'object' ? installment : {};
        const days = Number(item.dias);
        const overdue = Number.isFinite(days) && days > 0;
        const status = overdue ? 'Em atraso · ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(days) + (days === 1 ? ' dia' : ' dias') : 'Sem atraso';
        const values = [item.nome || 'Parcela sem nome', date(item.venc), date(item.ref), amount(item.valor), amount(item.juros), amount(item.multa), amount(item.total)];
        const cells = values.map((value, index) => {
          const font = index === 6 ? bold : regular;
          const numeric = index >= 3;
          const available = columnWidths[index] - (numeric ? 12 : 16);
          const measured = fontWidth(printable(value), font, 8.4);
          // Quantias altas usam até 6,5 pt e um pouco mais do espaço da
          // célula; só valores excepcionais precisam quebrar entre linhas.
          const size = numeric && measured > available ? Math.max(6.5, Math.floor(8.4 * available / measured * 100) / 100) : 8.4;
          return wrap(value, available, font, size).map(line => ({ text: line, size, font, color: palette.ink }));
        });
        wrap(status, columnWidths[0] - 16, regular, 7.3).forEach(line => cells[0].push({ text: line, size: 7.3, font: regular, color: overdue ? palette.amber : palette.green }));
        const lines = Math.max(...cells.map(cell => cell.length));
        const wholeHeight = lines * 13 + 16;
        // Linhas normais ficam inteiras; uma linha excepcionalmente longa
        // continua na próxima página, sem truncar nome, datas ou valores.
        if (cursor + wholeHeight > bottom && wholeHeight <= bottom - 184) newPage();
        let offset = 0;
        while (offset < lines) {
          const continuation = offset > 0;
          const padding = continuation ? 31 : 16;
          if (bottom - cursor < padding + 13) newPage();
          const count = Math.min(lines - offset, Math.max(1, Math.floor((bottom - cursor - padding) / 13)));
          const segmentHeight = count * 13 + padding;
          rectangle(margin, cursor, contentWidth, segmentHeight, installmentIndex % 2 ? palette.alternate : palette.white);
          if (continuation) text('Continuação da parcela ' + (installmentIndex + 1), margin + 8, cursor + 6, 7, bold, palette.muted);
          const firstLine = cursor + (continuation ? 23 : 8);
          let x = margin;
          cells.forEach((cell, index) => {
            for (let line = 0; line < count; line++) {
              const entry = cell[offset + line];
              if (entry) text(entry.text, index >= 3 ? x + columnWidths[index] - 8 : x + 8, firstLine + line * 13, entry.size, entry.font, entry.color, index >= 3 ? 'right' : 'left');
            }
            x += columnWidths[index];
          });
          cursor += segmentHeight;
          rule(cursor);
          offset += count;
          if (offset < lines) newPage();
        }
      });
      inTable = false;
      cursor += 20;
    }

    const suppliedTotals = report.totais && typeof report.totais === 'object' ? report.totais : {};
    // Uma lista vazia é apresentada com saldo zero. Nos outros casos os
    // totais são os calculados pelo app, sem recalcular ou arredondar parcelas.
    const totals = installments.length ? suppliedTotals : { condominio: 0, juros: 0, multa: 0, total: 0 };
    const summary = [
      ['Condomínio', totals.condominio, false],
      ['Juros', totals.juros, false],
      ['Multa', totals.multa, false],
      ['Total em aberto', totals.total, true]
    ].map(([label, value, prominent]) => {
      const size = prominent ? 20 : 10;
      const leading = prominent ? 25 : 15;
      const lines = wrap('R$ ' + amount(value), 256, prominent ? bold : regular, size);
      const rowHeight = Math.max(prominent ? 61 : 26, lines.length * leading + 18);
      return { label, prominent, size, leading, lines, rowHeight };
    });
    const rates = report.taxas && typeof report.taxas === 'object' ? report.taxas : {};
    const criteria = [
      ['CRITÉRIOS DESTE DEMONSTRATIVO', { size: 8, bold: true, color: palette.green, after: 6 }],
      ['Juros: ' + rate(rates.juros) + '% ao mês, proporcionais aos dias de atraso. Multa: ' + rate(rates.multa) + '% quando há atraso.', { size: 8.5, color: palette.muted, after: 5 }],
      ['A referência de cálculo é a data indicada em cada parcela e pode ser diferente da data de emissão. Gerar este documento não atualiza as referências nem quita parcelas.', { size: 8.5, color: palette.muted, after: 5 }],
      ['Parcelas sem atraso também integram o total em aberto. Este documento é um demonstrativo e não comprova pagamento.', { size: 8.5, color: palette.muted, after: 5 }],
      ['Valores exibidos com duas casas decimais. O total preserva o cálculo do aplicativo; o arredondamento de cada valor exibido pode produzir diferenças de centavos na soma manual.', { size: 8.5, color: palette.muted, after: 5 }]
    ];
    if (adaptedCharacters) criteria.push(['Alguns caracteres foram adaptados para compatibilidade com a fonte deste PDF.', { size: 8, color: palette.muted }]);
    const summaryHeight = summary.reduce((sum, item) => sum + item.rowHeight, 0);
    const criteriaHeight = criteria.reduce((sum, [value, config]) => sum + wrap(value, contentWidth, config.bold ? bold : regular, config.size).length * config.size * 1.45 + (config.after || 0), 0);
    const completeHeight = summaryHeight + 21 + criteriaHeight;
    // Preserve resumo e critérios como um bloco quando couberem em uma
    // página. A medida usa as mesmas quebras e entrelinhas da renderização.
    room(completeHeight <= bottom - 154 ? completeHeight : Math.min(summaryHeight, bottom - 154));
    summary.forEach(({ label, prominent, size, leading, lines, rowHeight }) => {
      room(rowHeight);
      let offset = 0;
      while (offset < lines.length) {
        const count = Math.min(lines.length - offset, Math.max(1, Math.floor((bottom - cursor - 18) / leading)));
        const segmentHeight = Math.max(prominent ? 61 : 26, count * leading + 18);
        rectangle(margin, cursor, contentWidth, segmentHeight, palette.pale);
        text(label + (offset ? ' (continuação)' : ''), margin + 16, cursor + (prominent ? 16 : 9), prominent ? 13 : 9.5, prominent ? bold : regular, prominent ? palette.green : palette.muted);
        lines.slice(offset, offset + count).forEach((line, index) => text(line, width - margin - 16, cursor + 9 + index * leading, size, prominent ? bold : regular, palette.green, 'right'));
        cursor += segmentHeight;
        offset += count;
        if (offset < lines.length) newPage();
      }
    });
    cursor += 21;
    room(Math.min(criteriaHeight, bottom - 154));
    criteria.forEach(([value, config]) => paragraph(value, config));

    function abbreviated(value, available) {
      const content = printable(value).replace(/\s+/g, ' ').trim();
      if (fontWidth(content, regular, 7.5) <= available) return content;
      let low = 0;
      let high = content.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (fontWidth(content.slice(0, middle) + '…', regular, 7.5) <= available) low = middle;
        else high = middle - 1;
      }
      return content.slice(0, low).trimEnd() + '…';
    }
    const footerUnit = abbreviated('Unidade ' + (report.unidade || 'não informada'), 145);
    const footerName = abbreviated(report.nome || 'Nome não informado', contentWidth - 120 - fontWidth(footerUnit + ' · ', regular, 7.5));
    pages.forEach((current, index) => {
      page = current;
      rule(height - 49);
      text(footerUnit + ' · ' + footerName, margin, height - 36, 7.5, regular, palette.muted);
      text('Página ' + (index + 1) + ' de ' + pages.length, width - margin, height - 36, 7.5, regular, palette.muted, 'right');
    });
    document.setTitle('Demonstrativo de débitos · Monte Verde Residencial');
    document.setAuthor('Monte Verde Residencial');
    document.setSubject('Parcelas abertas e referências de cálculo de um cadastro individual');
    document.setCreator('Monte Verde Residencial');
    document.setProducer('pdf-lib');
    document.setLanguage('pt-BR');
    return document.save({ useObjectStreams: true });
  }

  global.MonteVerdePDF = Object.freeze({ generate });
})(typeof window !== 'undefined' ? window : globalThis);
