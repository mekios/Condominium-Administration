import { Component, OnInit } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

import { AppDataService, Apartment, Me } from '../core/app-data.service';

@Component({
  standalone: true,
  selector: 'app-profile',
  imports: [NgIf, NgFor],
  template: `
    <section class="panel">
      <header class="head">
        <h2>Προφίλ χρήστη</h2>
        <p>Στοιχεία λογαριασμού και διαμερίσματα πρόσβασης.</p>
      </header>

      <p class="hint" *ngIf="loading">Φόρτωση στοιχείων...</p>

      <div class="profile-grid" *ngIf="!loading && me as user">
        <article class="card">
          <h3>Στοιχεία λογαριασμού</h3>
          <div class="kv"><span>Όνομα χρήστη</span><strong>{{ user.username }}</strong></div>
          <div class="kv"><span>Email</span><strong>{{ user.email || '-' }}</strong></div>
          <div class="kv"><span>Ρόλος</span><strong>{{ user.role }}</strong></div>
          <div class="kv"><span>Γλώσσα</span><strong>{{ user.preferred_language }}</strong></div>
        </article>

        <article class="card">
          <h3>Διαμερίσματα πρόσβασης</h3>
          <p class="hint" *ngIf="!apartments.length">Δεν υπάρχουν συνδεδεμένα διαμερίσματα.</p>
          <ul *ngIf="apartments.length">
            <li *ngFor="let apt of apartments">{{ apt.apartment_label }} <span>{{ apt.ownership_permille }}‰</span></li>
          </ul>
        </article>
      </div>
    </section>
  `,
  styles: `
    .panel { border: 1px solid #243152; background: #101a33; border-radius: 12px; padding: 1rem; }
    .head h2 { margin: 0; font-size: 1.05rem; }
    .head p, .hint { margin: 0.35rem 0 0.8rem; color: #93a8da; font-size: 0.9rem; }
    .profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.8rem; }
    .card { border: 1px solid #2a3a63; background: #0f1730; border-radius: 12px; padding: 0.85rem; }
    h3 { margin: 0 0 0.7rem; font-size: 0.95rem; color: #dce8ff; }
    .kv { display: flex; justify-content: space-between; gap: 0.6rem; padding: 0.38rem 0; border-bottom: 1px dashed #25365f; }
    .kv span { color: #96aede; font-size: 0.84rem; }
    .kv strong { color: #f3f7ff; font-size: 0.88rem; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
    li { border: 1px solid #28395f; border-radius: 10px; padding: 0.45rem 0.55rem; display: flex; justify-content: space-between; }
    li span { color: #9fbae9; }
    @media (max-width: 900px) { .profile-grid { grid-template-columns: 1fr; } }
  `,
})
export class ProfileComponent implements OnInit {
  me: Me | null = null;
  apartments: Apartment[] = [];
  loading = true;

  constructor(private readonly data: AppDataService) {}

  ngOnInit(): void {
    this.loading = true;
    this.data.getMe().subscribe({
      next: (me) => (this.me = me),
      error: () => (this.me = null),
    });
    this.data.getLinkedApartments().subscribe({
      next: (apartments) => {
        this.apartments = apartments;
        this.loading = false;
      },
      error: () => {
        this.apartments = [];
        this.loading = false;
      },
    });
  }
}
