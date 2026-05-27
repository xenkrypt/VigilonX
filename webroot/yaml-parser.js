/**
 * VigilonX – Lightweight YAML Parser for AutoModerator configs.
 * Handles the subset of YAML used by AutoModerator (document separators, key-value, lists).
 * This is NOT a full YAML parser — it targets Automod's specific patterns.
 */

/** Split a multi-document YAML string into individual rule documents */
function splitYamlDocuments(yaml) {
  if (!yaml || !yaml.trim()) return [];
  const docs = [];
  let current = '';
  let docStartLine = 1;
  let lineNum = 0;
  const lines = yaml.split('\n');
  for (const line of lines) {
    lineNum++;
    if (line.trim() === '---') {
      if (current.trim()) docs.push({ text: current.trim(), startLine: docStartLine });
      current = '';
      docStartLine = lineNum + 1;
    } else {
      if (current === '') docStartLine = lineNum;
      current += line + '\n';
    }
  }
  if (current.trim()) docs.push({ text: current.trim(), startLine: docStartLine });
  return docs;
}

/** Parse a simple YAML document into a key-value object (flat, handles lists and common nested blocks) */
function parseSimpleYaml(doc) {
  const result = {};
  const lines = doc.split('\n');

  const countIndent = (line) => (line.match(/^ */) || [''])[0].length;
  const cleanScalar = (value) => {
    const stripped = String(value || '').trim().replace(/^["']|["']$/g, '');
    if (stripped === 'true') return true;
    if (stripped === 'false') return false;
    if (/^\d+$/.test(stripped)) return parseInt(stripped, 10);
    return stripped;
  };
  const parseInlineList = (value) => {
    const inner = value.substring(1, value.length - 1);
    return inner.split(',').map(s => cleanScalar(s));
  };
  const nextContentLine = (start) => {
    for (let j = start; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t && !t.startsWith('#')) return j;
    }
    return -1;
  };
  const readBlockScalar = (start, baseIndent, folded) => {
    const block = [];
    let j = start;
    while (j < lines.length) {
      const raw = lines[j];
      const trimmed = raw.trim();
      if (trimmed && !trimmed.startsWith('#') && countIndent(raw) <= baseIndent) break;
      if (!trimmed) block.push('');
      else if (!trimmed.startsWith('#')) block.push(raw.substring(Math.min(countIndent(raw), baseIndent + 2)));
      j++;
    }
    return { value: folded ? block.join(' ').replace(/\s+/g, ' ').trim() : block.join('\n').trimEnd(), next: j - 1 };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || countIndent(line) > 0) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = trimmed.substring(0, colonIdx).trim();
    let value = trimmed.substring(colonIdx + 1).trim();

    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = parseInlineList(value);
    } else if (value === '|' || value === '>') {
      const block = readBlockScalar(i + 1, countIndent(line), value === '>');
      result[key] = block.value;
      i = block.next;
    } else if (value === '') {
      const nextIdx = nextContentLine(i + 1);
      if (nextIdx === -1 || countIndent(lines[nextIdx]) <= countIndent(line)) {
        result[key] = '';
        continue;
      }

      const nested = {};
      const listItems = [];
      let j = i + 1;
      while (j < lines.length) {
        const raw = lines[j];
        const t = raw.trim();
        if (t && !t.startsWith('#') && countIndent(raw) <= countIndent(line)) break;
        if (!t || t.startsWith('#')) {
          j++;
          continue;
        }
        if (t.startsWith('- ')) {
          listItems.push(cleanScalar(t.substring(2)));
          j++;
          continue;
        }
        const nestedColon = t.indexOf(':');
        if (nestedColon > 0) {
          const nestedKey = t.substring(0, nestedColon).trim();
          let nestedVal = t.substring(nestedColon + 1).trim();
          if (nestedVal === '|' || nestedVal === '>') {
            const block = readBlockScalar(j + 1, countIndent(raw), nestedVal === '>');
            nested[nestedKey] = block.value;
            result[`${key}.${nestedKey}`] = block.value;
            j = block.next + 1;
            continue;
          }
          const parsedVal = nestedVal.startsWith('[') && nestedVal.endsWith(']')
            ? parseInlineList(nestedVal)
            : cleanScalar(nestedVal);
          nested[nestedKey] = parsedVal;
          result[`${key}.${nestedKey}`] = parsedVal;
        }
        j++;
      }
      result[key] = listItems.length ? listItems : nested;
      i = j - 1;
    } else {
      result[key] = cleanScalar(value);
    }
  }

  return result;
}

/** Parse full Automod YAML into array of rule objects */
function parseAutomodConfig(yaml) {
  const docs = splitYamlDocuments(yaml);
  return docs.map((doc, idx) => ({
    index: idx,
    raw: doc.text,
    startLine: doc.startLine,
    parsed: parseSimpleYaml(doc.text),
  }));
}
