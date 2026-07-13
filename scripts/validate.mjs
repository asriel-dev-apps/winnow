#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function sentences(text) {
  return String(text || '').split('。').filter((part) => part.trim().length > 0).length;
}

function violation(rule, message, clusterId) {
  return clusterId ? { rule, cluster_id: clusterId, message } : { rule, message };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
  if (Object.hasOwn(data, 'release_watch')) {
    if (!Array.isArray(data.release_watch)) {
      errors.push(violation('release_watch', 'release_watch must be an array'));
    } else {
      const repos = new Set();
      for (const entry of data.release_watch) {
        const repo = entry?.repo;
        if (!nonEmpty(repo)) errors.push(violation('release_watch', 'release_watch entry repo must be non-empty'));
        else if (repos.has(repo)) errors.push(violation('release_watch', `release_watch repo must be unique: ${repo}`));
        else repos.add(repo);
        if (!Array.isArray(entry?.releases) || entry.releases.length === 0) {
          errors.push(violation('release_watch', `release_watch ${repo || '(missing repo)'} must have at least one release`));
        } else {
          for (const release of entry.releases) {
            if (!nonEmpty(release?.tag)) errors.push(violation('release_watch', `release_watch ${repo || '(missing repo)'} release tag must be non-empty`));
            if (!nonEmpty(release?.url)) errors.push(violation('release_watch', `release_watch ${repo || '(missing repo)'} release url must be non-empty`));
          }
        }
      }
    }
  }
  function validateRanking(key) {
    if (!Object.hasOwn(data, key)) return;
    if (!Array.isArray(data[key])) {
      errors.push(violation(key, `${key} must be an array`));
      return;
    }
    if (data[key].length > 10) errors.push(violation(key, `${key} must have at most 10 entries`));
    data[key].forEach((entry, index) => {
      if (Number(entry?.rank) !== index + 1) errors.push(violation(key, `${key} rank must be sequential from 1`));
      if (!nonEmpty(entry?.repo)) errors.push(violation(key, `${key} entry repo must be non-empty`));
      if (!nonEmpty(entry?.url)) errors.push(violation(key, `${key} entry url must be non-empty`));
    });
  }
  validateRanking('oss_ranking');
  validateRanking('oss_ranking_general');
  console.log(JSON.stringify(errors, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
