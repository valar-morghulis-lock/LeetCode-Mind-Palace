// ── DOM references ──────────────────────────────────────────────────────────
const syncBtn        = document.getElementById('syncBtn');
const counterBadge   = document.getElementById('counterBadge');
const lastSynced     = document.getElementById('lastSynced');
const lsTitle        = document.getElementById('lsTitle');
const lsTime         = document.getElementById('lsTime');
const problemPreview = document.getElementById('problemPreview');
const previewTitle   = document.getElementById('previewTitle');
const previewDiff    = document.getElementById('previewDiff');
const errorDetail    = document.getElementById('errorDetail');

// ── THEME ────────────────────────────────────────────────────────────────────
const THEME = {
  bgPage:      [255, 255, 255],
  surface:     [250, 250, 250],
  cardBorder:  [230, 230, 230],
  text:        [61,  64,  91],
  muted:       [108, 117, 125],
  accent:      [61,  64,  91],
  difficultyBg:[224, 111, 95],
  tagBg:       [167, 201, 87],
  codeBg:      [248, 248, 248],
  codeText:    [61,  64,  91],
  border:      [221, 221, 221],
  white:       [255, 255, 255],
};

// ── Persistent state ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPersistentState();
  syncBtn.addEventListener('click', handleExport);
});

function loadPersistentState() {
  chrome.storage.local.get(['lastExport', 'totalCount'], ({ lastExport, totalCount }) => {
    if (totalCount != null) counterBadge.textContent = totalCount;
    if (lastExport) {
      lsTitle.textContent = lastExport.title;
      lsTime.textContent  = timeAgo(lastExport.timestamp);
      lastSynced.classList.remove('hidden');
    }
  });
}

function saveExport(title) {
  chrome.storage.local.get(['totalCount'], ({ totalCount }) => {
    const newCount = (totalCount || 0) + 1;
    chrome.storage.local.set({ lastExport: { title, timestamp: Date.now() }, totalCount: newCount });
    counterBadge.textContent = newCount;
    chrome.action.setBadgeText({ text: String(newCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#e07a5f' });
  });
}

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60)    return `${d}s ago`;
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ── Step UI ───────────────────────────────────────────────────────────────────
function setStep(n, state, detail = '') {
  const el = document.getElementById(`step${n}`);
  if (el) el.className = `step ${state}`;
  const det = document.getElementById(`step${n}Detail`);
  if (det) det.textContent = detail;
}

function resetUI() {
  [1, 2, 3].forEach(n => setStep(n, '', ''));
  errorDetail.classList.remove('visible');
  errorDetail.textContent = '';
  problemPreview.classList.remove('visible');
  syncBtn.classList.remove('success');
}

function showError(n, msg) {
  setStep(n, 'error');
  errorDetail.textContent = msg;
  errorDetail.classList.add('visible');
}

// ── Main export handler ───────────────────────────────────────────────────────
async function handleExport() {
  resetUI();
  syncBtn.disabled = true;
  syncBtn.textContent = 'Exporting...';

  try {
    setStep(1, 'active');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isLeetCode = tab?.url?.includes('leetcode.com/problems/')
                    || tab?.url?.includes('leetcode.com/explore/');
    if (!isLeetCode) {
      showError(1, 'Open a LeetCode problem page first.');
      return;
    }

    let results;
    try {
      results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: extractLeetCodeData
      });
    } catch (e) {
      showError(1, `Script injection failed: ${e.message}`);
      return;
    }

    const data = results?.[0]?.result;
    if (!data)      { showError(1, 'Scraper returned no data.'); return; }
    if (data.error) { showError(1, `${data.phase}: ${data.error}`); return; }

    setStep(1, 'done', data.language);
    previewTitle.textContent = data.title;
    if (data.difficulty) {
      previewDiff.textContent = data.difficulty;
      previewDiff.className   = `diff-badge ${data.difficulty}`;
      previewDiff.style.display = '';
    } else {
      previewDiff.style.display = 'none';
    }
    problemPreview.classList.add('visible');

    setStep(2, 'active');
    let pdfBlob;
    try {
      pdfBlob = buildPdf(data);
    } catch (e) {
      console.error(e);
      showError(2, `PDF build failed: ${e.message}`);
      return;
    }
    setStep(2, 'done');

    setStep(3, 'active');
    const url = URL.createObjectURL(pdfBlob);
    const a   = document.createElement('a');
    a.href = url;
    a.download = `${data.slug}-solution.pdf`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();

    setStep(3, 'done');
    syncBtn.classList.add('success');
    syncBtn.textContent = 'PDF Downloaded';
    saveExport(data.title);
    lsTitle.textContent = data.title;
    lsTime.textContent  = 'just now';
    lastSynced.classList.remove('hidden');

  } finally {
    syncBtn.disabled = false;
    setTimeout(() => {
      syncBtn.textContent = 'Extract & Export PDF';
      syncBtn.classList.remove('success');
    }, 3000);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PDF BUILDER
// ═════════════════════════════════════════════════════════════════════════════
function buildPdf(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const PW          = 210;
  const PH          = 297;
  const ML          = 18;
  const MR          = 18;
  const CW          = PW - ML - MR;
  const FOOTER_H    = 10;
  const SAFE_BOTTOM = PH - FOOTER_H - 6;

  let y = 20;

  // ── Font helpers ───────────────────────────────────────────────────────────
  function sf(style = 'normal', size = 10) {
    if (style === 'code') { doc.setFont('courier', 'normal'); }
    else if (style === 'codebold') { doc.setFont('courier', 'bold'); }
    else if (style === 'bold') { doc.setFont('helvetica', 'bold'); }
    else { doc.setFont('helvetica', 'normal'); }
    doc.setFontSize(size);
  }

  function tc(...c) { doc.setTextColor(...c); }
  function fc(...c) { doc.setFillColor(...c); }
  function dc(...c) { doc.setDrawColor(...c); }
  function tw(str)  { return doc.getTextWidth(str); }

  // ── Page management ────────────────────────────────────────────────────────
  function need(h) {
    if (y + h > SAFE_BOTTOM) newPage();
  }

  function newPage() {
    drawFooter();
    doc.addPage();
    fc(...THEME.bgPage);
    doc.rect(0, 0, PW, PH, 'F');
    y = 18;
  }

  // ── Draw helpers ───────────────────────────────────────────────────────────
  function hline(ly, color = THEME.border) {
    dc(...color);
    doc.setLineWidth(0.25);
    doc.line(ML, ly, ML + CW, ly);
  }

  function rRect(x, ry, w, h, r, fill, stroke = null, lw = 0.25) {
    fc(...fill);
    doc.roundedRect(x, ry, w, h, r, r, 'F');
    if (stroke) {
      dc(...stroke);
      doc.setLineWidth(lw);
      doc.roundedRect(x, ry, w, h, r, r, 'S');
    }
  }

  function sectionTitle(label) {
    need(14);
    hline(y - 1);
    fc(...THEME.difficultyBg);
    doc.rect(ML, y + 0.5, 3, 5, 'F');
    sf('bold', 9);
    tc(...THEME.text);
    doc.text(label.toUpperCase(), ML + 6, y + 5);
    y += 10;
  }

  // ── Description parser ─────────────────────────────────────────────────────
  function drawDescription(text) {
    if (!text) return;

    const rawLines = text.split('\n');
    const LINE_H   = 5;
    const INDENT_X = ML + 6;  
    const BULLET_X = ML + 2;  

    rawLines.forEach(rawLine => {
      const line = rawLine.trim();
      if (!line) { y += 2; return; }

      const numMatch = line.match(/^(\d+)\.\s+(.+)/);
      if (numMatch) {
        need(LINE_H + 1);
        const num   = numMatch[1] + '.';
        const rest  = numMatch[2];
        sf('bold', 9);
        tc(...THEME.difficultyBg);
        doc.text(num, BULLET_X, y);
        sf('normal', 9);
        tc(...THEME.text);
        const wrapped = doc.splitTextToSize(rest, CW - 8);
        wrapped.forEach((wl, i) => {
          need(LINE_H);
          doc.text(wl, INDENT_X, y);
          y += LINE_H;
        });
        return;
      }

      const bulletMatch = line.match(/^[•\-\*]\s*(.+)/);
      if (bulletMatch) {
        need(LINE_H + 1);
        fc(...THEME.difficultyBg);
        doc.circle(BULLET_X + 1, y - 1.2, 1, 'F');
        sf('normal', 9);
        tc(...THEME.text);
        const wrapped = doc.splitTextToSize(bulletMatch[1], CW - 8);
        wrapped.forEach((wl, i) => {
          need(LINE_H);
          doc.text(wl, INDENT_X, y);
          y += LINE_H;
        });
        return;
      }

      sf('normal', 9.5);
      tc(...THEME.text);
      const wrapped = doc.splitTextToSize(line, CW);
      wrapped.forEach(wl => {
        need(LINE_H);
        doc.text(wl, ML, y);
        y += LINE_H;
      });
    });
  }

  // ── Constraints renderer ───────────────────────────────────────────────────
  function drawConstraints(text) {
    if (!text) return;

    const BULLET_X = ML + 2;   
    const TEXT_X   = ML + 6;   
    const TEXT_W   = CW - 8;
    const LINE_H   = 5;

    const lines = text.split('\n')
      .map(l => l.replace(/^[•\-\*]\s*/, '').trim())
      .filter(Boolean);

    lines.forEach(line => {
      const wrapped = doc.splitTextToSize(line, TEXT_W);
      const blockH  = wrapped.length * LINE_H + 2;
      need(blockH);

      fc(...THEME.difficultyBg);
      doc.circle(BULLET_X, y - 1.2, 1, 'F');

      sf('normal', 8.5);
      tc(...THEME.text);
      wrapped.forEach((wl, i) => {
        doc.text(wl, TEXT_X, y + i * LINE_H);
      });
      y += blockH;
    });
  }

  // ── Examples renderer ──────────────────────────────────────────────────────
  function drawExamples(text) {
    if (!text) return;

    const blocks = text.trim().split(/\n(?=Example\s*\d)/i).filter(Boolean);

    blocks.forEach(block => {
      const blockLines = block.trim().split('\n');

      let headerLine  = '';
      const rows = [];  
      let currentLabel = null;
      let currentValue = [];

      blockLines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed) return;

        if (/^Example\s*\d+\s*:/i.test(trimmed)) {
          headerLine = trimmed;
          return;
        }

        const labelMatch = trimmed.match(/^(Input|Output|Explanation)\s*:?\s*(.*)/i);
        if (labelMatch) {
          if (currentLabel) rows.push({ label: currentLabel, value: currentValue.join(' ').trim() });
          currentLabel = labelMatch[1];
          currentValue = labelMatch[2] ? [labelMatch[2]] : [];
        } else {
          if (currentLabel) currentValue.push(trimmed);
        }
      });
      if (currentLabel) rows.push({ label: currentLabel, value: currentValue.join(' ').trim() });

      const INNER_LINE_H = 5.5;
      const HEADER_H     = headerLine ? 7 : 0;
      let contentH = 0;
      rows.forEach(({ value }) => {
        const wrapped = doc.splitTextToSize(value || '', CW - 28);
        contentH += wrapped.length * INNER_LINE_H;
      });
      const cardH = HEADER_H + contentH + rows.length * 1 + 8;

      need(cardH + 4);

      rRect(ML, y, CW, cardH, 3, THEME.surface, THEME.cardBorder);

      fc(...THEME.difficultyBg);
      doc.roundedRect(ML, y, 2.5, cardH, 1.5, 1.5, 'F');

      let innerY = y + 5;

      if (headerLine) {
        sf('bold', 8.5);
        tc(...THEME.text);
        doc.text(headerLine, ML + 6, innerY);
        innerY += HEADER_H;
      }

      rows.forEach(({ label, value }) => {
        const valWrapped = doc.splitTextToSize(value || '', CW - 30);

        sf('bold', 8);
        tc(...THEME.difficultyBg);
        doc.text(label + ':', ML + 6, innerY);

        sf('code', 8.5);
        tc(...THEME.text);
        const labelW = tw(label + ':  ');
        if (valWrapped.length === 1 && tw(valWrapped[0]) + labelW < CW - 22) {
          doc.text(valWrapped[0], ML + 6 + labelW, innerY);
          innerY += INNER_LINE_H;
        } else {
          innerY += 4;
          valWrapped.forEach(wl => {
            doc.text(wl, ML + 10, innerY);
            innerY += INNER_LINE_H;
          });
        }
      });

      y += cardH + 5;
    });
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  function drawFooter() {
    const p     = doc.getCurrentPageInfo().pageNumber;
    const total = doc.getNumberOfPages();
    const fy    = PH - FOOTER_H;

    fc(...THEME.bgPage);
    doc.rect(0, fy, PW, FOOTER_H, 'F');
    fc(...THEME.difficultyBg);
    doc.rect(0, fy, PW, 0.6, 'F');

    sf('code', 7);
    tc(...THEME.muted);
    doc.text('LeetCode Mind Palace', ML, fy + 6);
    doc.text(`${p} / ${total}`, PW - MR, fy + 6, { align: 'right' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PAGE 1 — HEADER
  // ══════════════════════════════════════════════════════════════════════════
  fc(...THEME.bgPage);
  doc.rect(0, 0, PW, PH, 'F');

  fc(...THEME.difficultyBg);
  doc.rect(0, 0, PW, 2, 'F');

  sf('bold', 22);
  tc(...THEME.text);
  doc.text(data.title || 'Untitled', ML, 18);

  let metaY = 22;
  if (data.difficulty) {
    const diff   = data.difficulty.toUpperCase();
    const badgeW = tw(diff) + 10;
    rRect(ML, metaY, badgeW, 7, 2, THEME.difficultyBg, THEME.difficultyBg);
    sf('bold', 8);
    tc(...THEME.muted);
    doc.text(diff, ML + badgeW / 2, metaY + 5.2, { align: 'center' });

    sf('normal', 8.5);
    tc(...THEME.muted);
    doc.text(data.category || 'Algorithms', ML + badgeW + 5, metaY + 5.2);
  } else {
    sf('normal', 8.5);
    tc(...THEME.muted);
    doc.text(data.category || 'Algorithms', ML, metaY + 5.2);
  }

  if (data.topicTags) {
    const tags = data.topicTags.split(',').map(t => t.trim()).filter(Boolean);
    let tx = ML;
    const tagsY = data.difficulty ? 33 : 31;
    tags.slice(0, 8).forEach(tag => {
      const tagW = tw(tag) + 6;
      if (tx + tagW > PW - MR) return;
      rRect(tx, tagsY, tagW, 5.5, 1.5, THEME.tagBg, THEME.cardBorder, 0.2);
      sf('normal', 7);
      tc(...THEME.text);
      doc.text(tag, tx + 3, tagsY + 3.8);
      tx += tagW + 3;
    });
  }

  y = 48;

  // ══════════════════════════════════════════════════════════════════════════
  // DESCRIPTION
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle('Description');
  drawDescription(data.description || 'No description found.');
  y += 4;

  // ══════════════════════════════════════════════════════════════════════════
  // EXAMPLES
  // ══════════════════════════════════════════════════════════════════════════
  if (data.examples?.trim()) {
    sectionTitle('Examples');
    drawExamples(data.examples);
    y += 2;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONSTRAINTS
  // ══════════════════════════════════════════════════════════════════════════
  if (data.constraints?.trim()) {
    sectionTitle('Constraints');
    drawConstraints(data.constraints);
    y += 4;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SOLUTION — carbon terminal
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle('Solution');

  const TERM_HEADER_H = 9;
  const lang          = data.language || 'Java';

  function drawTerminalHeader() {
    need(TERM_HEADER_H + 2);
    fc(...THEME.codeBg);
    doc.roundedRect(ML, y, CW, TERM_HEADER_H, 2, 2, 'F');
    fc(...THEME.codeBg);
    doc.rect(ML, y + TERM_HEADER_H - 2, CW, 2, 'F');
    dc(...THEME.cardBorder);
    doc.setLineWidth(0.2);
    doc.roundedRect(ML, y, CW, TERM_HEADER_H, 2, 2, 'S');

    [[224,111,95],[167,201,87],[61,64,91]].forEach((c, i) => {
      fc(...c);
      doc.circle(ML + 5 + i * 5.5, y + TERM_HEADER_H / 2, 1.5, 'F');
    });

    sf('bold', 7.5);
    tc(...THEME.muted);
    doc.text(lang, ML + CW - 4, y + TERM_HEADER_H / 2 + 1, { align: 'right' });

    y += TERM_HEADER_H;
  }

  const codeLines  = (data.solutionCode || '// No solution found').split('\n');
  const CODE_LINE_H = 4.2;
  const GUTTER_W    = 11;
  const CODE_X      = ML + GUTTER_W + 2;
  const CODE_W      = CW - GUTTER_W - 4;

  const wrappedLines = [];
  codeLines.forEach((line, idx) => {
    const parts = doc.splitTextToSize(line || ' ', CODE_W);
    parts.forEach((part, pi) => {
      wrappedLines.push({ text: part, lineNum: idx + 1, isCont: pi > 0 });
    });
  });

  drawTerminalHeader();

  let lineIdx = 0;
  while (lineIdx < wrappedLines.length) {
    const availH    = SAFE_BOTTOM - y;
    const maxFit    = Math.max(1, Math.floor((availH - 6) / CODE_LINE_H));
    const chunkSize = Math.min(wrappedLines.length - lineIdx, maxFit);
    const chunk     = wrappedLines.slice(lineIdx, lineIdx + chunkSize);
    const isLast    = lineIdx + chunkSize >= wrappedLines.length;
    const bodyH     = chunk.length * CODE_LINE_H + 6;

    fc(...THEME.bgPage);
    if (isLast) {
      doc.rect(ML, y, CW, bodyH - 3, 'F');
      doc.roundedRect(ML, y + bodyH - 5, CW, 5, 2, 2, 'F');
    } else {
      doc.rect(ML, y, CW, bodyH, 'F');
    }

    dc(...THEME.cardBorder);
    doc.setLineWidth(0.2);
    doc.rect(ML, y, CW, bodyH, 'S');

    fc(...THEME.codeBg);
    doc.rect(ML, y, GUTTER_W, bodyH, 'F');

    dc(...THEME.cardBorder);
    doc.setLineWidth(0.2);
    doc.line(ML + GUTTER_W, y, ML + GUTTER_W, y + bodyH);

    chunk.forEach((wl, i) => {
      const lineY = y + 5 + i * CODE_LINE_H;

      if (!wl.isCont) {
        sf('code', 6.5);
        tc(...THEME.muted);
        doc.text(String(wl.lineNum).padStart(3, ' '), ML + 1.5, lineY);
      }

      sf('code', 7.8);
      tc(...THEME.codeText);
      doc.text(wl.text, CODE_X, lineY);
    });

    y += bodyH;
    lineIdx += chunkSize;

    if (lineIdx < wrappedLines.length) {
      newPage();
      drawTerminalHeader();
    }
  }

  y += 4;

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter();
  }

  return doc.output('blob');
}

// ═════════════════════════════════════════════════════════════════════════════
// SCRAPER (MAIN world)
// ═════════════════════════════════════════════════════════════════════════════
function extractLeetCodeData() {
  const path = window.location.pathname;

  if (path.includes('/explore/')) {
    // ── EXPLORE PAGE ────────────────────────────────────────────────────────
    try {
      const iframe = document.querySelector('iframe');
      if (!iframe) return { error: 'Explore iframe not found', phase: 'EXPLORE_SCRAPE' };

      const d = iframe.contentDocument;
      if (!d) return { error: 'iframe.contentDocument inaccessible', phase: 'EXPLORE_SCRAPE' };

      const titleEl  = d.querySelector('.question-title')
                    || d.querySelector('h4')
                    || d.querySelector('h3');
      const title     = titleEl ? titleEl.innerText.trim() : 'Untitled Problem';
      const slug      = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const difficulty = null;
      const category  = 'Algorithms';
      const topicTags = Array.from(d.querySelectorAll('a[href*="/tag/"], [class*="topic-tag"]'))
                          .map(t => t.innerText.trim()).filter(Boolean).join(', ');

      // FIX: Query explicit description targets FIRST so substring rules do not hit the editor frame
      let descEl = d.querySelector('.question-content')
                || d.querySelector('.question-description')
                || d.querySelector('[class*="description__"]');

      // Fallback selector check with rigorous exclusion parameters
      if (!descEl) {
        const structuralMatches = Array.from(d.querySelectorAll('[class*="content__"], article, .question-detail'));
        descEl = structuralMatches.find(el => {
          const txt = el.innerText;
          return txt && !txt.includes('OpenJDK') && !txt.includes('compile arguments');
        }) || structuralMatches[0];
      }

      let description = 'No description found.';
      let examples    = '';
      let constraints = '';

      if (descEl) {
        let sanitized = descEl.innerText;

        const exIdx  = sanitized.search(/Example\s*\d\s*:/i);
        const conIdx = sanitized.search(/Constraints\s*:/i);
        const fuIdx  = sanitized.search(/Follow-?up\s*:/i);

        description = exIdx !== -1 ? sanitized.slice(0, exIdx).trim() : sanitized.trim();

        const exBlocks = Array.from(descEl.querySelectorAll('.example-block, pre'));
        if (exBlocks.length > 0) {
          examples = exBlocks
            .map((b, i) => {
              const txt = b.innerText.trim();
              if (!txt || txt.includes('expectedNums') || txt.includes('OpenJDK')) return null;
              return /^Example\s*\d/i.test(txt) ? txt : `Example ${i + 1}:\n${txt}`;
            })
            .filter(Boolean).join('\n\n');
        }

        if (!examples && exIdx !== -1) {
          const end = [fuIdx, conIdx].filter(i => i > exIdx).sort((a, b) => a - b)[0] ?? sanitized.length;
          examples = sanitized.slice(exIdx, end).trim();
        }

        if (conIdx !== -1) {
          constraints = sanitized.slice(conIdx).replace(/^Constraints\s*:\s*/i, '').trim();
          const followIdx = constraints.search(/Follow-?up\s*:/i);
          if (followIdx !== -1) constraints = constraints.slice(0, followIdx).trim();
        }
      }

      let solutionCode = '';
      const cmEl = d.querySelector('.CodeMirror');
      if (cmEl) {
        const lines = Array.from(cmEl.querySelectorAll('.CodeMirror-line'));
        if (lines.length > 0) {
          solutionCode = lines.map(l => l.textContent).join('\n');
        }
      }

      if (!solutionCode || solutionCode.trim().length < 10) {
        const textarea = d.querySelector('.CodeMirror + textarea, textarea.ace_text-input, textarea');
        if (textarea) solutionCode = textarea.value;
      }

      if (!solutionCode || solutionCode.trim().length < 10) {
        solutionCode = '// Solution extraction failed.';
      }

      let language = 'Java';
      const langSelect = d.querySelector('select[name="lang"], #id_lang, [name="language"]');
      if (langSelect) {
        language = langSelect.options[langSelect.selectedIndex]?.text || 'Java';
      } else {
        const langLabel = Array.from(d.querySelectorAll('[class*="label"]'))
          .find(el => el.children.length === 0 && el.innerText.trim().length > 0
                   && el.innerText.trim().length < 20);
        if (langLabel) language = langLabel.innerText.trim();
      }

      return { title, slug, difficulty, category, topicTags, description, examples, constraints, solutionCode, language };

    } catch (e) {
      return { error: e.message, phase: 'EXPLORE_SCRAPE' };
    }

  } else {
    // ── PROBLEMS PAGE ───────────────────────────────────────────────────────
    try {
      const titleEl =
        document.querySelector('[data-cy="question-title"]')
        || document.querySelector('.text-title-large')
        || document.querySelector('h1');

      const fullTitle = titleEl ? titleEl.innerText.trim() : document.title;
      const title     = fullTitle.replace(/^\d+\.\s*/, '').trim() || 'Untitled Problem';

      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const probIdx   = pathParts.indexOf('problems');
      const slug      = probIdx !== -1 ? pathParts[probIdx + 1]
                      : title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      let difficulty = 'EASY';
      for (const el of document.querySelectorAll('div, span')) {
        if (el.children.length > 0) continue;
        const t = el.innerText.trim().toUpperCase();
        if (t === 'EASY' || t === 'MEDIUM' || t === 'HARD') { difficulty = t; break; }
      }

      const category  = (path.includes('/database/') || document.title.toLowerCase().includes('sql'))
                      ? 'Database' : 'Algorithms';
      const topicTags = Array.from(document.querySelectorAll('a[href*="/tag/"]'))
                          .map(t => t.innerText.trim()).filter(Boolean).join(', ');

      const contentArea =
        document.querySelector('[data-track-load="description_content"]')
        || document.querySelector('.xFUwe');

      let description = 'No description found.';
      let examples    = '';
      let constraints = '';

      if (contentArea) {
        let sanitized = contentArea.cloneNode(true).innerText;
        const lower   = sanitized.toLowerCase();

        if (lower.includes('custom judge:')) {
          const s = lower.indexOf('custom judge:');
          const e = lower.indexOf('accepted.', s);
          if (e !== -1) sanitized = sanitized.slice(0, s) + sanitized.slice(e + 'accepted.'.length);
        }

        const exIdx  = sanitized.search(/Example\s*\d\s*:/i);
        const conIdx = sanitized.search(/Constraints\s*:/i);
        const fuIdx  = sanitized.search(/Follow-?up\s*:/i);

        description = exIdx !== -1 ? sanitized.slice(0, exIdx).trim() : sanitized.trim();

        const exBlocks = Array.from(contentArea.querySelectorAll('.example-block'));
        if (exBlocks.length > 0) {
          examples = exBlocks
            .map((b, i) => {
              const txt = b.innerText.trim();
              if (!txt || txt.includes('expectedNums')) return null;
              return /^Example\s*\d/i.test(txt) ? txt : `Example ${i + 1}:\n${txt}`;
            })
            .filter(Boolean).join('\n\n');
        }

        if (!examples) {
          const pres = Array.from(contentArea.querySelectorAll('pre'))
            .filter(p => p.innerText.includes('Input:') && p.innerText.includes('Output:'));
          if (pres.length > 0) {
            examples = pres.map((p, i) => `Example ${i + 1}:\n${p.innerText.trim()}`).join('\n\n');
          }
        }

        if (!examples && exIdx !== -1) {
          const end = [fuIdx, conIdx].filter(i => i > exIdx).sort((a, b) => a - b)[0] ?? sanitized.length;
          examples = sanitized.slice(exIdx, end).trim();
        }

        const constraintLis = contentArea.querySelectorAll('ul li, div[class*="constraint"] li');
        if (constraintLis.length > 0) {
          constraints = Array.from(constraintLis).map(li => li.innerText.trim()).filter(Boolean).join('\n');
        } else if (conIdx !== -1) {
          constraints = sanitized.slice(conIdx).replace(/^Constraints\s*:\s*/i, '').trim();
          const followIdx = constraints.search(/Follow-?up\s*:/i);
          if (followIdx !== -1) constraints = constraints.slice(0, followIdx).trim();
        }
      }

      let solutionCode = '';
      try {
        if (window.monaco?.editor) {
          const models = window.monaco.editor.getModels();
          if (models?.length) {
            const target = models.find(m => {
              const v = m.getValue();
              return v.includes('class Solution') || v.includes('def ') || v.includes('function ');
            }) || models[0];
            solutionCode = target.getValue();
          }
        }
      } catch (e) { /* silent */ }

      if (!solutionCode || solutionCode.trim().length < 10) {
        const editor = document.querySelector('.monaco-editor');
        if (editor) {
          const lines = Array.from(editor.querySelectorAll('.view-line'));
          lines.sort((a, b) => parseInt(a.style.top || 0) - parseInt(b.style.top || 0));
          const seen = new Set(); const out = [];
          for (const l of lines) {
            const top = parseInt(l.style.top || 0);
            if (!seen.has(top)) { seen.add(top); out.push(l.textContent || ''); }
          }
          solutionCode = out.join('\n');
        }
      }

      if (!solutionCode || solutionCode.trim().length < 10) {
        solutionCode = '// Solution extraction failed.';
      }

      let language = 'Java';
      const langBtn = document.querySelector('button[id^="headlessui-listbox-button-"]')
                   || document.querySelector('.cursor-pointer .text-xs');
      if (langBtn) {
        const token = langBtn.innerText.trim().split('\n')[0];
        if (token && token.toLowerCase() !== 'choose a type') language = token;
      }

      return { title, slug, difficulty, category, topicTags, description, examples, constraints, solutionCode, language };

    } catch (e) {
      return { error: e.message, phase: 'PROBLEMS_SCRAPE' };
    }
  }
}