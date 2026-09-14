import { safeDurableLesson } from "./policy.ts";
export function filterLessons(lessons: Array<{ content: string; importance: number }>, maxItems: number): Array<{ content: string; importance: number }> {
  const limit = Number.isFinite(maxItems) ? Math.max(0, Math.floor(maxItems)) : 0;
  if (!limit) return [];
  const seen = new Set<string>();
  return lessons.filter((lesson) => {
    if (!safeDurableLesson(lesson.content) || !Number.isFinite(lesson.importance)) return false;
    const key = lesson.content.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.importance - a.importance).slice(0, limit);
}
