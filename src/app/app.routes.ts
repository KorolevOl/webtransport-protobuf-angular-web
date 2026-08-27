import { Routes } from '@angular/router';
import { authRoutes } from '../plugins/auth/auth.routes';

/**
 * Корневые маршруты приложения. Плагин «auth» подключается одной строкой
 * (корневой §7: «плагинная модульность»). Новый домен = новый массив routes +
 * строка в этом месте.
 */
export const routes: Routes = [
  ...authRoutes,
  // TODO: будущие домены (event.v1, …) — добавляются строкой.
];
