import type { GoogleFormData, FormQuestion } from '../shared/llm.types';

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
      console.log('[Form Solver] Received response from service worker:', response);
    },
  );
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
