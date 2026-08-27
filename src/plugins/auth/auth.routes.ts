// auth.routes.ts — маршруты плагина auth + guard'ы (корневой §1: «нет токена = редирект на логин»).
//
// - `authGuard`: нет активной сессии → запоминаем URL в sessionStorage
//   и несём на `/login` (после входа — вернёмся сюда, см. auth-login.component).
// - `guestGuard`: уже залогинен → несём на `/` (главную).

import { inject } from '@angular/core';
import { Routes, Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';

import { AuthService } from './auth.service';
import { AuthLoginComponent } from './auth-login.component';
import { AuthRegisterComponent } from './auth-register.component';
import { HomeComponent } from './home.component';

const REDIRECT_KEY = 'awp.redirect.to';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) {
    return true;
  }
  sessionStorage.setItem(REDIRECT_KEY, router.url);
  return router.parseUrl('/login');
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) {
    return router.parseUrl('/');
  }
  return true;
};

export const authRoutes: Routes = [
  { path: '', component: HomeComponent, canActivate: [authGuard] },
  { path: 'login', component: AuthLoginComponent, canActivate: [guestGuard] },
  { path: 'register', component: AuthRegisterComponent, canActivate: [guestGuard] },
];
