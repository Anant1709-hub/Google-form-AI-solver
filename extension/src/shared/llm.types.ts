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
  images: FormImage[];
}

export interface GoogleFormData {
  title: string;
  questions: FormQuestion[];
}

export interface FormAnswer {
  questionIndex: number;
  answer: string[];
}

export interface FormAnswers {
  answers: FormAnswer[];
}

export interface FormImage {
  src: string;
  alt: string;
}
