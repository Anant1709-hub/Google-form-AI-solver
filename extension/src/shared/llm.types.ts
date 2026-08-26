export interface FormQuestion {
  index: number;
  question: string;
  type:
    | 'multiple-choice'
    | 'checkbox'
    | 'dropdown'
    | 'short-answer'
    | 'paragraph'
    | 'scale'
    | 'unknown';
  options: string[];
  required: boolean;
}

export interface GoogleFormData {
  title: string;
  questions: FormQuestion[];
}

export interface FormAnswer {
  questionIndex: number;
  answer: string | string[];
}

export interface FormAnswers {
  answers: FormAnswer[];
}
