#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function sentences(text) {
  return String(text || '').split('。').filter((part) => part.trim().length > 0).length;
}

function violation(rule, message, clusterId) {
  return clusterId ? { rule, cluster_id: clusterId, message } : { rule, message };
}

try {
  const file = process.argv[2];
  if (!file) throw new Error('usage: validate.mjs <stories.json>');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const errors = [];
  const stories = Array.isArray(data.stories) ? data.stories : [];
  const normalCount = stories.filter((s) => !s.is_serendipity).length;
  const serendipityCount = stories.filter((s) => s.is_serendipity).length;
  if (normalCount < 1 || normalCount > 15) errors.push(violation('story_count', 'normal story count must be 1-15'));
  if (serendipityCount > 2) errors.push(violation('story_count', 'serendipity story count must be 0-2'));
  if (!Array.isArray(data.macro_summary) || data.macro_summary.length !== 3) errors.push(violation('macro_summary', 'macro_summary must have exactly 3 entries'));
  for (const story of stories) {
    const cid = story.cluster_id || '(missing)';
    const count = sentences(story.summary);
    if (count < 2 || count > 3) errors.push(violation('summary', 'summary must contain 2-3 Japanese sentences ending with 。', cid));
    if (!story.selection_reason || String(story.selection_reason).includes('\n')) errors.push(violation('selection_reason', 'selection_reason must be non-empty and single-line', cid));
    if (!story.translated_title) errors.push(violation('translated_title', 'translated_title must be non-empty', cid));
    if (!Array.isArray(story.items) || story.items.length === 0) {
      errors.push(violation('items', 'story must have at least one item', cid));
    } else {
      for (const item of story.items) {
        if (!item.url) errors.push(violation('items', `item ${item.id || '(missing id)'} must have url`, cid));
      }
    }
    if (!story.is_serendipity && Number(story.composite_score) < 55) errors.push(violation('composite_score', 'normal story composite_score must be >= 55', cid));
  }
  console.log(JSON.stringify(errors, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
