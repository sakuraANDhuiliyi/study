import { scienceModules } from './academics.modules-science';
import { engineeringModules } from './academics.modules-engineering';
import { businessModules } from './academics.modules-business';
import { humanitiesModules, quizModules } from './academics.modules-humanities';
export const academicModules = [
  ...engineeringModules,
  ...scienceModules,
  ...businessModules,
  ...humanitiesModules,
  ...quizModules,
];
export const getAcademicModule = (id: string) => academicModules.find((module) => module.id === id);
