import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { email, form, FormField, maxLength, minLength, required, type FieldTree } from '@angular/forms/signals';
import { AuthError, AuthService } from './auth.service';

interface LoginModel { email: string; password: string; }

@Component({
  selector: 'auth-login',
  imports: [RouterLink, FormField],
  templateUrl: './auth-login.html',
  styleUrl: './auth-form.scss'
})
export class AuthLoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly form: FieldTree<LoginModel>;

  constructor() {
    const model = signal<LoginModel>({ email: '', password: '' });
    this.form = form(model, (p) => {
      required(p.email, { message: 'E-mail обязателен' });
      email(p.email, { message: 'Похоже, это не e-mail' });
      required(p.password, { message: 'Пароль обязателен' });
      minLength(p.password, 6, { message: 'Минимум 6 символов' });
      maxLength(p.password, 128, { message: 'Максимум 128 символов' });
    });
  }

  protected onSubmit(): void {
    // root state — для валидации; сабфилды — на дереве this.form.email / .password
    const root = this.form();
    if (root.invalid()) {
      this.form.email().markAsTouched();
      this.form.password().markAsTouched();
      return;
    }
    const v = root.value();
    this.busy.set(true);
    this.serverError.set(null);
    this.auth.login(v.email.trim(), v.password).then(() => {
      const saved = sessionStorage.getItem('awp.redirect.to') ?? '/';
      sessionStorage.removeItem('awp.redirect.to');
      this.router.navigateByUrl(saved);
    }).catch((e: unknown) => this.serverError.set(this.human(e))).finally(() => this.busy.set(false));
  }

  private human(e: unknown): string {
    if (e instanceof AuthError) {
      if (e.code === 1) return 'Неверный e-mail или пароль';
      if (e.code === 2) return 'E-mail уже зарегистрирован';
      if (e.code === 4) return 'Сессия недействительна';
      return e.message;
    }
    return e instanceof Error ? e.message : 'Ошибка сети';
  }
}
