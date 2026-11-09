import type { SortingQuestion as Entry } from "./sorting";

export type SortingQuestion = Entry<{ text?: string | null; media?: Question["media"] }>;

export type Question = {
  initialColor?: string;
  /**
   * Stable identifier for associating answers with questions.
   */
  id?: string | number;
  finalizedStep?: number;
  /**
   * Optional description for the question
   */
  prompt?: string;
  /**
   * Optional media attached to the question.
   */
  media?: {
    storagePath: string;
    contentType?: string | null;
    size?: number | null;
    filename?: string | null;
    originalPath?: string | null;
  } | null;
  /**
   * Previously entered answer, if any.
   */
  answer?: string;
};

type RoundData = {
  /**
   * Stable identifier for rounds.
   */
  id: string;
  /**
   * Name of the round displayed in the header.
   */
  title: string;
  /**
   * Numeric order of the round, shown in the label.
   */
  roundNumber: number;
  /**
   * Optional helper text under the title.
   */
  description?: string;
  /**
   * Custom wrapper class name.
   */
  className?: string;
  /**
   * Optional label to be displayed when there are no questions available.
   */
  emptyLabel?: string;
  presenting?: {
    round?: string | null;
    question?: string | null;
    promptPage?: number;
    withAnswer?: boolean;
  } | null;
};

export type TextRoundData = RoundData & {
  allowWager?: boolean;
  type: "text";
  /**
   * List of text questions in the round
   */
  questions: Question[];
  roomSlug?: string;
  teamId?: string;
  /**
   * Fires when the saved text answer is manually locked.
   */
  onAnswer?: (question: Question, answer: string) => void;
};

export type CluesRoundData = Omit<TextRoundData, "type"> & { type: "clues" };

export type ImageItem = {
    /**
     * Identifier to match this image with a description.
     */
    id: string | number;
    /**
     * Source for the image asset.
     */
    src: string;
    /**
     * Accessible alternative text for the image prompt.
     */
    alt?: string;
    /**
     * Optional helper label rendered alongside the image.
     */
    label?: string;
};

export type MultiStepRoundData = RoundData & {
  type: "multi-step";
  allowAnswerChanges: boolean;
  questions: Question[];
  roomSlug?: string;
  teamId?: string;
};

export type ImageRoundData = RoundData & {
  type: "image";
  /**
   * Text descriptions that should be matched with an image.
   */
  questions: Question[];
  /**
   * Images whose dropzones receive draggable descriptions.
   */
  images: ImageItem[];

  
  roomSlug?: string;
  teamId?: string;
  
  /**
   * Fires whenever an answer is submitted.
   */
  onAnswer?: (question: Question, answer: ImageItem) => void;
};

export type ColorRoundData = RoundData & {
  type: "color";
  questions: Question[];
  roomSlug?: string;
  teamId?: string;
};

export type SortingRoundData = RoundData & {
  type: "sorting";
  criterion: string;
  startingOrder?: string[];
  state: "active" | "closed";
  questions: SortingQuestion[];
  roomSlug?: string;
  teamId?: string;
};

export type QuizRoundData = TextRoundData | CluesRoundData | ImageRoundData | MultiStepRoundData | ColorRoundData | SortingRoundData;
