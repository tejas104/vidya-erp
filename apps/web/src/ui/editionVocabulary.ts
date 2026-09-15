export type Edition = "college" | "school";

export type EditionVocabulary = {
  institution: string;
  academicYear: string;
  term: string;
  academicTerms: string;
};

const VOCABULARY: Record<Edition, EditionVocabulary> = {
  college: {
    institution: "College",
    academicYear: "Academic Year",
    term: "Term",
    academicTerms: "Academic terms",
  },
  school: {
    institution: "School",
    academicYear: "Academic Year",
    term: "Term",
    academicTerms: "Academic Terms",
  },
};

export const schoolVocabulary = VOCABULARY.school;

export function vocabularyFor(edition: Edition): EditionVocabulary {
  return VOCABULARY[edition];
}
