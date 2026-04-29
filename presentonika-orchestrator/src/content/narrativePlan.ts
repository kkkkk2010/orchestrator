export type TopicKind = "literary_figure" | "person" | "historical" | "science" | "concept";

export type NarrativeSlidePlan = {
  slide: number;
  purpose: string;
  functionLabel: string;
  focus: string;
  expectedKeywords: string[];
  relationToPrevious?: string;
  relationToNext?: string;
};

export type NarrativePlanContext = {
  topic: string;
  topicKind: TopicKind;
  centralQuestion: string;
  thesis: string;
  slides: NarrativeSlidePlan[];
  antiRepetitionRules: string[];
};

type SelectedLayoutLike = {
  slide: number;
  slideType: string;
  layoutId: string;
};

const lc = (value: string): string => value.toLowerCase();

export const detectTopicKind = (topic: string): TopicKind => {
  const normalized = lc(topic);

  if (/пушкин|лермонтов|толстой|достоевск|гогол|чехов|тургенев|есенин|маяковск|ахматов|цветаев|блок|поэт|писател|литератур/.test(normalized)) {
    return "literary_figure";
  }

  if (/войн|революц|импери|государств|реформ|средневек|древн|битв|царь|король|султан|истори/.test(normalized)) {
    return "historical";
  }

  if (/физик|хими|биолог|математ|атом|молекул|энерг|клетк|экосистем|электр|алгоритм|информат/.test(normalized)) {
    return "science";
  }

  const words = topic.trim().split(/\s+/).filter(Boolean);
  const titleCaseWords = words.filter((word) => /^[А-ЯЁA-Z][а-яёa-z-]+$/.test(word));
  if (titleCaseWords.length >= 2 && words.length <= 4) {
    return "person";
  }

  return "concept";
};

const buildQuestion = (topic: string, topicKind: TopicKind): string => {
  const cleanTopic = topic.trim() || "тема";
  if (/пушкин/i.test(cleanTopic)) {
    return "Почему Пушкина считают точкой сборки современного русского литературного языка?";
  }

  if (topicKind === "literary_figure") {
    return `Почему ${cleanTopic} стал(а) не просто важной фигурой, а поворотной точкой литературного языка и культуры?`;
  }
  if (topicKind === "person") {
    return `Почему ${cleanTopic} стал(а) центральной фигурой своей эпохи и что через него/неё изменилось?`;
  }
  if (topicKind === "historical") {
    return `Как ${cleanTopic} меняет ход событий и почему последствия важнее набора дат?`;
  }
  if (topicKind === "science") {
    return `Как работает ${cleanTopic} и почему этот принцип помогает объяснять реальные явления?`;
  }
  return `Какую проблему объясняет ${cleanTopic} и почему эта тема важна для понимания мира?`;
};

const buildThesis = (topic: string, topicKind: TopicKind): string => {
  const cleanTopic = topic.trim() || "тема";
  if (/пушкин/i.test(cleanTopic)) {
    return "Пушкин важен не только количеством произведений, а тем, что он связал живую речь, литературные жанры, исторический контекст и новый тип героя.";
  }

  if (topicKind === "literary_figure") {
    return `${cleanTopic} важен(важна) не отдельными фактами биографии, а тем, как его/её тексты связывают язык, жанры, эпоху и новый культурный опыт.`;
  }
  if (topicKind === "person") {
    return `Значение темы раскрывается через связь контекста, поступков, идей и последствий, а не через простой список дат.`;
  }
  if (topicKind === "historical") {
    return `${cleanTopic} нужно понимать через причины, участников, поворотные решения и последствия, которые меняют дальнейшее развитие.`;
  }
  if (topicKind === "science") {
    return `${cleanTopic} становится понятнее, когда мы связываем явление, принцип, механизм, примеры и применение.`;
  }
  return `${cleanTopic} раскрывается как последовательность: проблема, контекст, механизм, примеры, проверка понимания и вывод.`;
};

const baseSlides = (topicKind: TopicKind): NarrativeSlidePlan[] => {
  if (topicKind === "literary_figure") {
    return [
      { slide: 1, purpose: "frame", functionLabel: "frame central question", focus: "поставить главный вопрос о роли фигуры", expectedKeywords: ["вопрос", "роль", "язык", "литература"] },
      { slide: 2, purpose: "route", functionLabel: "show route of proof", focus: "объяснить маршрут доказательства: контекст, язык, произведения, влияние", expectedKeywords: ["объяснить", "показать", "связать", "контекст", "язык"] },
      { slide: 3, purpose: "problem/hook", functionLabel: "pose paradox/problem", focus: "открыть парадокс: почему значение нельзя объяснить культом имени", expectedKeywords: ["почему", "парадокс", "значение", "не только"] },
      { slide: 4, purpose: "context", functionLabel: "explain historical and language context", focus: "показать эпоху, языковую ситуацию и культурный конфликт", expectedKeywords: ["эпоха", "контекст", "язык", "общество"] },
      { slide: 5, purpose: "evidence/mechanism", functionLabel: "show concrete mechanisms of influence", focus: "объяснить механизмы влияния: речь, жанры, герой, исторический материал", expectedKeywords: ["механизм", "речь", "жанр", "герой", "влияние"] },
      { slide: 6, purpose: "comparison", functionLabel: "compare early and mature phases", focus: "сравнить ранний и зрелый этапы как развитие метода", expectedKeywords: ["ранний", "зрелый", "сравнить", "реализм", "романтизм"] },
      { slide: 7, purpose: "development over time", functionLabel: "trace biography as development of role", focus: "показать биографию как траекторию формирования литературной роли", expectedKeywords: ["этап", "траектория", "формирование", "роль"] },
      { slide: 8, purpose: "examples as evidence", functionLabel: "use works as evidence", focus: "дать произведения как доказательства центрального тезиса", expectedKeywords: ["пример", "произведение", "показывает", "доказывает"] },
      { slide: 9, purpose: "check understanding", functionLabel: "check understanding of argument", focus: "проверить понимание связи контекста, языка, произведений и вывода", expectedKeywords: ["почему", "как", "сравни", "объясни"] },
      { slide: 10, purpose: "conclusion", functionLabel: "answer central question", focus: "вернуться к главному вопросу и сформулировать ответ", expectedKeywords: ["вывод", "значит", "ответ", "потому"] },
    ];
  }

  if (topicKind === "historical") {
    return [
      { slide: 1, purpose: "frame", functionLabel: "frame central problem", focus: "поставить проблему и масштаб события", expectedKeywords: ["проблема", "масштаб", "поворот"] },
      { slide: 2, purpose: "route", functionLabel: "show route of explanation", focus: "объяснить маршрут: причины, событие, последствия, оценка", expectedKeywords: ["объяснить", "причины", "последствия", "оценить"] },
      { slide: 3, purpose: "problem/hook", functionLabel: "pose historical tension", focus: "открыть конфликт или развилку", expectedKeywords: ["конфликт", "почему", "выбор"] },
      { slide: 4, purpose: "context", functionLabel: "explain causes and context", focus: "показать условия и причины", expectedKeywords: ["причины", "условия", "контекст"] },
      { slide: 5, purpose: "evidence/mechanism", functionLabel: "show key mechanisms", focus: "разобрать решения, силы и механизм изменения", expectedKeywords: ["решение", "механизм", "участники"] },
      { slide: 6, purpose: "comparison", functionLabel: "compare sides or periods", focus: "сравнить стороны, периоды или позиции", expectedKeywords: ["сравнить", "стороны", "периоды"] },
      { slide: 7, purpose: "development over time", functionLabel: "trace sequence", focus: "показать развитие событий как цепочку причин и следствий", expectedKeywords: ["этап", "следствие", "развитие"] },
      { slide: 8, purpose: "examples as evidence", functionLabel: "use examples as proof", focus: "примеры показывают последствия и разные оценки", expectedKeywords: ["пример", "последствие", "оценка"] },
      { slide: 9, purpose: "check understanding", functionLabel: "check causal understanding", focus: "проверить причинно-следственные связи", expectedKeywords: ["почему", "как", "последствия"] },
      { slide: 10, purpose: "conclusion", functionLabel: "answer central problem", focus: "сформулировать итог о причинах и последствиях", expectedKeywords: ["вывод", "причина", "последствие"] },
    ];
  }

  if (topicKind === "science") {
    return [
      { slide: 1, purpose: "frame", functionLabel: "frame phenomenon", focus: "поставить явление и главный вопрос", expectedKeywords: ["явление", "вопрос", "принцип"] },
      { slide: 2, purpose: "route", functionLabel: "show route from phenomenon to use", focus: "маршрут: явление, принцип, механизм, примеры, применение", expectedKeywords: ["объяснить", "показать", "применить"] },
      { slide: 3, purpose: "problem/hook", functionLabel: "pose observable puzzle", focus: "показать наблюдаемый парадокс", expectedKeywords: ["почему", "наблюдение", "парадокс"] },
      { slide: 4, purpose: "context", functionLabel: "define principle in context", focus: "объяснить принцип без сухого определения", expectedKeywords: ["принцип", "условия", "работает"] },
      { slide: 5, purpose: "evidence/mechanism", functionLabel: "show mechanism", focus: "раскрыть механизм работы", expectedKeywords: ["механизм", "процесс", "связь"] },
      { slide: 6, purpose: "comparison", functionLabel: "compare cases", focus: "сравнить условия или модели", expectedKeywords: ["сравнить", "условия", "модель"] },
      { slide: 7, purpose: "development over time", functionLabel: "trace steps of process", focus: "показать процесс по шагам", expectedKeywords: ["этап", "шаг", "процесс"] },
      { slide: 8, purpose: "examples as evidence", functionLabel: "use applications as evidence", focus: "примеры показывают применение принципа", expectedKeywords: ["пример", "применение", "показывает"] },
      { slide: 9, purpose: "check understanding", functionLabel: "check transfer of principle", focus: "проверить перенос принципа на новую ситуацию", expectedKeywords: ["объясни", "почему", "применить"] },
      { slide: 10, purpose: "conclusion", functionLabel: "answer how it works", focus: "ответить на главный вопрос через принцип и механизм", expectedKeywords: ["вывод", "принцип", "механизм"] },
    ];
  }

  return [
    { slide: 1, purpose: "frame", functionLabel: "frame central question", focus: "поставить главный вопрос темы", expectedKeywords: ["вопрос", "проблема", "значение"] },
    { slide: 2, purpose: "route", functionLabel: "show route of lesson", focus: "показать маршрут: проблема, контекст, механизм, примеры, вывод", expectedKeywords: ["объяснить", "сравнить", "доказать", "связать"] },
    { slide: 3, purpose: "problem/hook", functionLabel: "pose problem", focus: "открыть проблему или противоречие", expectedKeywords: ["почему", "проблема", "противоречие"] },
    { slide: 4, purpose: "context", functionLabel: "explain context", focus: "дать контекст и смысловые границы", expectedKeywords: ["контекст", "роль", "условия"] },
    { slide: 5, purpose: "evidence/mechanism", functionLabel: "show mechanism", focus: "объяснить механизм или доказательство", expectedKeywords: ["механизм", "причина", "значение"] },
    { slide: 6, purpose: "comparison", functionLabel: "compare sides", focus: "сравнить разные стороны темы", expectedKeywords: ["сравнить", "различие", "сходство"] },
    { slide: 7, purpose: "development over time", functionLabel: "trace development", focus: "показать развитие или последовательность", expectedKeywords: ["этап", "развитие", "последовательность"] },
    { slide: 8, purpose: "examples as evidence", functionLabel: "use examples as proof", focus: "использовать примеры как доказательство", expectedKeywords: ["пример", "показывает", "доказательство"] },
    { slide: 9, purpose: "check understanding", functionLabel: "check understanding", focus: "проверить понимание центральной линии", expectedKeywords: ["почему", "как", "объясни"] },
    { slide: 10, purpose: "conclusion", functionLabel: "answer central question", focus: "ответить на главный вопрос и собрать вывод", expectedKeywords: ["вывод", "ответ", "значит"] },
  ];
};

export const buildNarrativePlan = (params: {
  topic: string;
  selectedLayouts?: SelectedLayoutLike[];
}): NarrativePlanContext => {
  const topic = params.topic.trim() || "тема";
  const topicKind = detectTopicKind(topic);
  const layoutBySlide = new Map((params.selectedLayouts || []).map((row) => [row.slide, row]));

  const slides = baseSlides(topicKind).map((slide, index, all) => {
    const layout = layoutBySlide.get(slide.slide);
    return {
      ...slide,
      focus: layout ? `${slide.focus}; layout=${layout.layoutId}, type=${layout.slideType}` : slide.focus,
      relationToPrevious: index > 0 ? `continues slide ${all[index - 1].slide}: ${all[index - 1].purpose}` : undefined,
      relationToNext: index < all.length - 1 ? `sets up slide ${all[index + 1].slide}: ${all[index + 1].purpose}` : undefined,
    };
  });

  return {
    topic,
    topicKind,
    centralQuestion: buildQuestion(topic, topicKind),
    thesis: buildThesis(topic, topicKind),
    slides,
    antiRepetitionRules: [
      "Treat the deck as one coherent lesson, not independent slides.",
      "Each slide must advance the central argument with a new step.",
      "Do not repeat the thesis on every slide; add evidence, context, comparison, or conclusion.",
      "Slide 2 defines the route; slides 4-8 must follow it.",
      "Slide 3 opens the problem; slides 4-8 develop it.",
      "Slide 10 must answer the central question introduced at the beginning.",
      "Examples must support the thesis, not just list works or facts.",
      "Quiz questions must test the central argument and slide sequence, not isolated trivia.",
    ],
  };
};

export const sourceFallbackForTopic = (topic: string, topicKind: TopicKind): string => {
  const normalized = lc(topic);
  if (topicKind === "literary_figure" || /литератур|пушкин|поэт|писател/.test(normalized)) {
    return "Источники: школьный учебник литературы, тексты произведений, литературоведческие справочники.";
  }
  if (topicKind === "historical") {
    return "Источники: школьный учебник истории, исторические карты, энциклопедические справочники.";
  }
  if (topicKind === "science") {
    return "Источники: школьный учебник, научно-популярные справочники, материалы профильных образовательных сайтов.";
  }
  return "Источники: школьный учебник, энциклопедические справочники, образовательные материалы по теме.";
};
