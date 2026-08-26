import type { GoogleFormData, FormQuestion } from '../shared/llm.types';
import type { FormAnswer, FormAnswers } from '../shared/llm.types';

function cleanText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get text associated with an element through:
 *
 * aria-label
 * aria-labelledby
 * title
 * textContent
 */
function getAccessibleText(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');

  if (ariaLabel) {
    return cleanText(ariaLabel);
  }

  const labelledBy = element.getAttribute('aria-labelledby');

  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => {
        const labelledElement = document.getElementById(id);

        return labelledElement?.textContent ?? '';
      })
      .join(' ');

    if (cleanText(text)) {
      return cleanText(text);
    }
  }

  const title = element.getAttribute('title');

  if (title) {
    return cleanText(title);
  }

  return cleanText(element.textContent);
}

function findQuestionContainers(): Element[] {
  const listItems = Array.from(document.querySelectorAll('[role="listitem"]'));

  const candidates: Element[] = [];

  for (const item of listItems) {
    const hasControl = !!item.querySelector(
      [
        '[role="radio"]',
        '[role="checkbox"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="slider"]',
        'textarea',
        'input[type="text"]',
        'input:not([type])',
      ].join(','),
    );

    /*
     * A real question should contain an input/control.
     *
     * This immediately eliminates section headers such as
     * "Quiz Questions".
     */
    if (!hasControl) {
      continue;
    }

    candidates.push(item);
  }

  /*
   * Google Forms can contain nested listitems.
   *
   * For example:
   *
   * Question listitem
   *   ├── checkbox listitem
   *   ├── checkbox listitem
   *   └── checkbox listitem
   *
   * We only want the outer question listitem.
   */
  const questionContainers = candidates.filter((candidate) => {
    return !candidates.some((other) => other !== candidate && other.contains(candidate));
  });

  return questionContainers;
}

/**
 * Extract the most likely question text from
 * a question container.
 */
function extractQuestionText(container: Element): string {
  /*
   * First preference:
   * accessibility heading.
   */
  const heading = container.querySelector('[role="heading"]');

  if (heading) {
    const text = getAccessibleText(heading);

    if (text) {
      return text;
    }
  }

  /*
   * Second preference:
   * labels.
   */
  const labels = container.querySelectorAll('label');

  for (const label of labels) {
    const text = cleanText(label.textContent);

    if (text) {
      return text;
    }
  }

  /*
   * Third preference:
   * aria-labelledby from controls.
   */
  const control = container.querySelector(
    '[role="radio"], [role="checkbox"], [role="combobox"], textarea, input',
  );

  if (control) {
    const labelledBy = control.getAttribute('aria-labelledby');

    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');

      if (cleanText(text)) {
        return cleanText(text);
      }
    }

    const ariaLabel = control.getAttribute('aria-label');

    if (ariaLabel) {
      return cleanText(ariaLabel);
    }
  }

  return '';
}

/**
 * Determine question type.
 */
function detectQuestionType(container: Element): FormQuestion['type'] {
  if (container.querySelector('[role="radio"]')) {
    return 'multiple-choice';
  }

  if (container.querySelector('[role="checkbox"]')) {
    return 'checkbox';
  }

  if (container.querySelector('[role="combobox"], [role="listbox"]')) {
    return 'dropdown';
  }

  /*
   * Google Forms commonly uses textarea-like
   * textbox elements for paragraph answers.
   */
  const textareas = container.querySelectorAll('textarea');

  if (textareas.length > 0) {
    return 'paragraph';
  }

  /*
   * Text input.
   */
  const textInput = container.querySelector('input[type="text"], input:not([type])');

  if (textInput) {
    return 'short-answer';
  }

  /*
   * Sliders / scales.
   */
  if (container.querySelector('[role="slider"]')) {
    return 'scale';
  }

  return 'unknown';
}

/**
 * Extract options from radio / checkbox controls.
 */
function extractOptions(container: Element): string[] {
  const controls = container.querySelectorAll('[role="radio"], [role="checkbox"]');

  const options: string[] = [];

  controls.forEach((control) => {
    let text = '';

    /*
     * aria-label
     */
    const ariaLabel = control.getAttribute('aria-label');

    if (ariaLabel) {
      text = cleanText(ariaLabel);
    }

    /*
     * aria-labelledby
     */
    if (!text) {
      const labelledBy = control.getAttribute('aria-labelledby');

      if (labelledBy) {
        text = cleanText(
          labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' '),
        );
      }
    }

    /*
     * Look around the control.
     */
    if (!text) {
      const parent = control.parentElement;

      if (parent) {
        text = cleanText(parent.textContent);
      }
    }

    if (text && !options.includes(text)) {
      options.push(text);
    }
  });

  return options;
}

/**
 * Extract dropdown information.
 */
function extractDropdownOptions(container: Element): string[] {
  /*
   * Google Forms often doesn't put all dropdown
   * options into the DOM until the dropdown is opened.
   *
   * Therefore this function currently checks
   * whatever options are already available.
   */

  const options = container.querySelectorAll('[role="option"]');

  return Array.from(options)
    .map((option) => getAccessibleText(option))
    .filter(Boolean);
}

function isRequired(container: Element): boolean {
  /*
   * First check aria-required.
   */
  if (container.querySelector('[aria-required="true"]')) {
    return true;
  }

  /*
   * Check aria-labels.
   *
   * Google Forms may expose "Required" through
   * accessibility information rather than visible text.
   */
  const labelledElements = container.querySelectorAll('[aria-label], [aria-labelledby]');

  for (const element of labelledElements) {
    const ariaLabel = element.getAttribute('aria-label');

    if (ariaLabel && /required/i.test(ariaLabel)) {
      return true;
    }
  }

  /*
   * Google Forms displays a red "*" for required
   * questions.
   *
   * Check for the visible star in the question area.
   */
  const questionText = cleanText(container.textContent);

  if (questionText.includes('*')) {
    return true;
  }

  return false;
}

/**
 * Extract all questions.
 */
function scanForm(): GoogleFormData {
  const containers = findQuestionContainers();

  const questions: FormQuestion[] = [];

  containers.forEach((container, index) => {
    const question = extractQuestionText(container);

    const type = detectQuestionType(container);

    let options: string[] = [];

    if (type === 'multiple-choice' || type === 'checkbox') {
      options = extractOptions(container);
    }

    if (type === 'dropdown') {
      options = extractDropdownOptions(container);
    }

    /*
     * Ignore things that don't actually look
     * like questions.
     */
    if (!question || (type === 'unknown' && options.length === 0)) {
      return;
    }

    questions.push({
      index,
      question,
      type,
      options,
      required: isRequired(container),
    });
  });

  /*
   * Try to find the form title.
   */
  const titleElement = document.querySelector('[role="heading"][aria-level="1"]');

  const title = titleElement ? getAccessibleText(titleElement) : '';

  return {
    title,
    questions,
  };
}

/**
 * Start scanner.
 */
function initializeFormReader(): void {
  console.log('[Form Solver] Content script loaded');

  console.log('[Form Solver] URL:', window.location.href);

  const form = scanForm();

  console.log('[Form Solver] FORM DATA:');

  console.log(JSON.stringify(form, null, 2));

  chrome.runtime.sendMessage(
    {
      type: 'SOLVE_FORM',
      formData: form,
    },
    (response) => {
      console.log('[Form Solver] Received response:', response);

      if (response?.message === 'FILL_FORM') {
        fillForm(response.answers);
      }
    },
  );
}

function fillForm(answers: FormAnswer[]): void {
  console.log('[Form Solver] ===== FILL FORM =====');

  if (!Array.isArray(answers)) {
    console.error('[Form Solver] Expected answers to be an array:', answers);
    return;
  }

  const containers = findQuestionContainers();

  console.log('[Form Solver] Found', containers.length, 'question containers');

  console.log('[Form Solver] Filling', answers.length, 'answers');

  for (const answer of answers) {
    console.group(`[Form Solver] Question ${answer.questionIndex}`);

    console.log('[Form Solver] Answer:', answer);

    const container = containers[answer.questionIndex];

    if (!container) {
      console.error('[Form Solver] Question container not found:', answer.questionIndex);

      console.groupEnd();
      continue;
    }

    console.log('[Form Solver] Container:', container);

    console.log('[Form Solver] Question text:', cleanText(container.textContent));

    const type = detectQuestionType(container);

    console.log('[Form Solver] Detected type:', type);

    switch (type) {
      case 'multiple-choice':
        fillMultipleChoice(container, String(answer.answer));
        break;

      case 'checkbox':
        fillCheckboxes(
          container,
          Array.isArray(answer.answer) ? answer.answer : [String(answer.answer)],
        );
        break;

      case 'short-answer':
        fillShortAnswer(container, String(answer.answer));
        break;

      case 'paragraph':
        fillParagraph(container, String(answer.answer));
        break;

      case 'dropdown':
        fillDropdown(container, String(answer.answer));
        break;

      case 'scale':
        fillScale(container, String(answer.answer));
        break;

      default:
        console.warn('[Form Solver] Unsupported question type:', type);
        break;
    }

    console.groupEnd();
  }

  console.log('[Form Solver] ===== FILL FORM COMPLETE =====');
}

/**
 * Normalize text before comparing an AI answer
 * with an option displayed in the form.
 */
function normalizeAnswer(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Get the accessible/displayed text of an option.
 */
function getOptionText(element: Element): string {
  const ariaLabel = element.getAttribute('aria-label');

  if (ariaLabel) {
    return cleanText(ariaLabel);
  }

  const labelledBy = element.getAttribute('aria-labelledby');

  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');

    if (cleanText(text)) {
      return cleanText(text);
    }
  }

  return cleanText(element.textContent);
}

// function fillMultipleChoice(container: Element, answer: string): boolean {
//   const radios = Array.from(container.querySelectorAll('[role="radio"]'));

//   const target = normalizeAnswer(answer);

//   for (const radio of radios) {
//     const optionText = getOptionText(radio);

//     if (normalizeAnswer(optionText) === target) {
//       const checked = radio.getAttribute('aria-checked');

//       if (checked !== 'true') {
//         (radio as HTMLElement).click();
//       }

//       console.log('[Form Solver] Selected radio:', optionText);

//       return true;
//     }
//   }

//   console.warn('[Form Solver] Multiple-choice option not found:', answer);

//   return false;
// }

function fillMultipleChoice(container: Element, answer: string): boolean {
  console.group('[Form Solver] fillMultipleChoice');

  console.log('[Form Solver] AI answer:', answer);

  const radios = Array.from(container.querySelectorAll('[role="radio"]'));

  console.log('[Form Solver] Radios found:', radios.length);

  radios.forEach((radio, index) => {
    console.log(`[Form Solver] Radio ${index}:`, {
      element: radio,
      text: getOptionText(radio),
      ariaChecked: radio.getAttribute('aria-checked'),
      ariaLabel: radio.getAttribute('aria-label'),
      labelledBy: radio.getAttribute('aria-labelledby'),
    });
  });

  const target = normalizeAnswer(answer);

  console.log('[Form Solver] Normalized target:', target);

  for (const radio of radios) {
    const optionText = getOptionText(radio);

    const normalizedOption = normalizeAnswer(optionText);

    console.log('[Form Solver] Comparing:', {
      answer: target,
      option: normalizedOption,
      match: target === normalizedOption,
    });

    if (normalizedOption === target) {
      console.log('[Form Solver] ✅ MATCH FOUND', optionText);

      const checked = radio.getAttribute('aria-checked');

      console.log('[Form Solver] Current checked state:', checked);

      if (checked !== 'true') {
        console.log('[Form Solver] Clicking radio...');

        (radio as HTMLElement).click();

        console.log('[Form Solver] After click aria-checked:', radio.getAttribute('aria-checked'));
      }

      console.groupEnd();
      return true;
    }
  }

  console.error('[Form Solver] ❌ Radio answer not found:', answer);

  console.groupEnd();
  return false;
}

function fillCheckboxes(container: Element, answers: string[]): boolean {
  const checkboxes = Array.from(container.querySelectorAll('[role="checkbox"]'));

  let foundAny = false;

  const normalizedAnswers = answers.map(normalizeAnswer);

  for (const checkbox of checkboxes) {
    const optionText = getOptionText(checkbox);

    const normalizedOption = normalizeAnswer(optionText);

    if (normalizedAnswers.includes(normalizedOption)) {
      foundAny = true;

      const checked = checkbox.getAttribute('aria-checked');

      if (checked !== 'true') {
        (checkbox as HTMLElement).click();
      }

      console.log('[Form Solver] Selected checkbox:', optionText);
    }
  }

  if (!foundAny) {
    console.warn('[Form Solver] None of the checkbox answers were found:', answers);
  }

  return foundAny;
}

function fillShortAnswer(container: Element, answer: string): boolean {
  const input = container.querySelector(
    'input[type="text"], input:not([type])',
  ) as HTMLInputElement | null;

  if (!input) {
    console.warn('[Form Solver] Short-answer input not found.');

    return false;
  }

  setInputValue(input, answer);

  console.log('[Form Solver] Filled short answer:', answer);

  return true;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  /*
   * Use the native HTMLInputElement setter.
   *
   * This is more reliable for frameworks/custom
   * controls than simply doing:
   *
   * input.value = value
   */
  const prototype = Object.getPrototypeOf(input);

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(
    new Event('input', {
      bubbles: true,
    }),
  );

  input.dispatchEvent(
    new Event('change', {
      bubbles: true,
    }),
  );

  input.dispatchEvent(
    new Event('blur', {
      bubbles: true,
    }),
  );
}

function fillParagraph(container: Element, answer: string): boolean {
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;

  if (!textarea) {
    console.warn('[Form Solver] Paragraph textarea not found.');

    return false;
  }

  setTextareaValue(textarea, answer);

  console.log('[Form Solver] Filled paragraph:', answer);

  return true;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const prototype = Object.getPrototypeOf(textarea);

  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  if (descriptor?.set) {
    descriptor.set.call(textarea, value);
  } else {
    textarea.value = value;
  }

  textarea.dispatchEvent(
    new Event('input', {
      bubbles: true,
    }),
  );

  textarea.dispatchEvent(
    new Event('change', {
      bubbles: true,
    }),
  );

  textarea.dispatchEvent(
    new Event('blur', {
      bubbles: true,
    }),
  );
}

function fillDropdown(container: Element, answer: string): boolean {
  const dropdown = container.querySelector(
    '[role="combobox"], [role="listbox"]',
  ) as HTMLElement | null;

  if (!dropdown) {
    console.warn('[Form Solver] Dropdown not found.');

    return false;
  }

  /*
   * Open the dropdown.
   */
  dropdown.click();

  /*
   * Google Forms may render the options
   * asynchronously after the click.
   *
   * We therefore look for them on the next
   * event-loop turn.
   */
  setTimeout(() => {
    const options = Array.from(document.querySelectorAll('[role="option"]'));

    const target = normalizeAnswer(answer);

    for (const option of options) {
      const optionText = getOptionText(option);

      if (normalizeAnswer(optionText) === target) {
        (option as HTMLElement).click();

        console.log('[Form Solver] Selected dropdown:', optionText);

        return;
      }
    }

    console.warn('[Form Solver] Dropdown option not found:', answer);
  }, 100);

  return true;
}

function fillScale(container: Element, answer: string): boolean {
  return fillMultipleChoice(container, answer);
}

initializeFormReader();

// function debugFormStructure(): void {
//   console.log('========== FORM DEBUG ==========');

//   console.log('listitems:', document.querySelectorAll('[role="listitem"]').length);

//   console.log('radios:', document.querySelectorAll('[role="radio"]').length);

//   console.log('checkboxes:', document.querySelectorAll('[role="checkbox"]').length);

//   console.log('comboboxes:', document.querySelectorAll('[role="combobox"]').length);

//   console.log('textareas:', document.querySelectorAll('textarea').length);

//   console.log(
//     'text inputs:',
//     document.querySelectorAll('input[type="text"], input:not([type])').length,
//   );

//   console.log('sliders:', document.querySelectorAll('[role="slider"]').length);

//   console.log('headings:', document.querySelectorAll('[role="heading"]').length);

//   console.log('================================');
// }

// debugFormStructure();
