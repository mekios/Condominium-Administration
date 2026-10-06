import { Component, Input, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIf } from '@angular/common';

@Component({
  standalone: true,
  selector: 'app-password-field',
  imports: [NgIf],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => PasswordFieldComponent),
      multi: true,
    },
  ],
  template: `
    <div class="password-field" [class.disabled]="disabled">
      <input
        [id]="inputId"
        [type]="visible ? 'text' : 'password'"
        [value]="value"
        [placeholder]="placeholder"
        [autocomplete]="autocomplete"
        [disabled]="disabled"
        [attr.aria-label]="ariaLabel || null"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
      <button
        type="button"
        class="toggle"
        (click)="toggle()"
        [disabled]="disabled"
        [attr.aria-label]="visible ? 'Απόκρυψη κωδικού' : 'Εμφάνιση κωδικού'"
        [attr.aria-pressed]="visible"
      >
        <svg *ngIf="!visible" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8" />
        </svg>
        <svg *ngIf="visible" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M3 3l18 18M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2M9.9 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.1 4.1M6.1 6.1A17.4 17.4 0 0 0 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4.1-.8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  `,
  styles: `
    .password-field {
      position: relative;
      display: block;
      width: 100%;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding-right: 2.6rem;
    }
    .toggle {
      position: absolute;
      top: 50%;
      right: 0.35rem;
      transform: translateY(-50%);
      display: inline-grid;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #9db2e5;
      cursor: pointer;
      padding: 0;
    }
    .toggle:hover:not(:disabled) {
      color: #dce8ff;
      background: rgba(157, 178, 229, 0.12);
    }
    .toggle:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .toggle svg {
      width: 1.15rem;
      height: 1.15rem;
      display: block;
    }
    .disabled {
      opacity: 0.85;
    }
  `,
})
export class PasswordFieldComponent implements ControlValueAccessor {
  @Input() placeholder = '';
  @Input() autocomplete = 'current-password';
  @Input() inputId = '';
  @Input() ariaLabel = '';

  value = '';
  disabled = false;
  visible = false;

  private onChange: (value: string) => void = () => undefined;
  onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    this.value = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value = next;
    this.onChange(next);
  }

  toggle(): void {
    this.visible = !this.visible;
  }
}
