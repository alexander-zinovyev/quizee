/** Question media yields to a revealed answer that has its own media. */
export function isQuestionMediaPlaybackActive({ withAnswer, hasQuestionMedia, hasAnswerMedia }: {
  withAnswer: boolean; hasQuestionMedia: boolean; hasAnswerMedia: boolean;
}): boolean {
  return !(withAnswer && hasQuestionMedia && hasAnswerMedia);
}
