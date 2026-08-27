import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { email, form, FormField, maxLength, minLength, required, type FieldTree } from '@angular/forms/signals';
import { AuthError, AuthService } from '../../auth.service';

interface RegisterModel { email: string; password: string; displayName: string; }

@Component({
  selector: 'auth-register',
  imports: [RouterLink, FormField],
  templateUrl: './auth-register.html',
  styleUrl: '../auth-form.scss'
})
export class AuthRegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly serverError = signal<string | null>(null);
  protected readonly form: FieldTree<RegisterModel>;

  constructor() {
    const model = signal<RegisterModel>({ email: '', password: '', displayName: '' });
    this.form = form(model, (p) => {
      required(p.email, { message: 'E-mail обязателен' });
      email(p.email, { message: 'Похоже, это не e-mail' });
      required(p.password, { message: 'Пароль обязателен' });
      minLength(p.password, 6, { message: 'Минимум 6 символов' });
      maxLength(p.password, 128, { message: 'Максимум 128 символов' });
    });
  }

  protected onSubmit(): void {
    const root = this.form();
    if (root.invalid()) {
      this.form.email().markAsTouched();
      this.form.password().markAsTouched();
      return;
    }
    const v = root.value();
    this.busy.set(true);
    this.serverError.set(null);
    this.auth.register(v.email.trim(), v.password, v.displayName.trim())
      .then(() => this.router.navigateByUrl('/'))
      .catch((e: unknown) => this.serverError.set(this.human(e)))
      .finally(() => this.busy.set(false));
  }

  private human(e: unknown): string {
    if (e instanceof AuthError) {
      if (e.code === 2) return 'E-mail уже зарегистрирован';
      return e.message;
    }
    return e instanceof Error ? e.message : 'Ошибка сети';
  }
}
