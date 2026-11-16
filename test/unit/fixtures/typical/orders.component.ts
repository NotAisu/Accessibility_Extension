import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Order {
  id: string;
  date: Date;
  total: number;
  status: 'open' | 'shipped' | 'delivered';
  thumbnail: string;
}

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h2>Your orders</h2>
    <p *ngIf="orders.length === 0">You have not ordered anything yet.</p>
    <ul class="orders">
      <li *ngFor="let order of orders; trackBy: byId" [class.open]="order.status === 'open'">
        <img [src]="order.thumbnail">
        <span class="date">{{ order.date | date }}</span>
        <span class="total">{{ order.total | currency: 'EUR' }}</span>
        <span class="status">{{ order.status }}</span>
        <div class="details" (click)="select.emit(order)">Details</div>
        <button type="button" (click)="cancel.emit(order)" *ngIf="order.status === 'open'">Cancel order</button>
      </li>
    </ul>
    <a href="/orders/archive"></a>
  `,
  styles: [`
    .orders { list-style: none; padding: 0; }
    .open { font-weight: bold; }
  `]
})
export class OrdersComponent {
  @Input() orders: Order[] = [];
  @Output() select = new EventEmitter<Order>();
  @Output() cancel = new EventEmitter<Order>();

  byId(_index: number, order: Order): string {
    return order.id;
  }
}

@Component({
  selector: 'app-order-badge',
  standalone: true,
  template: `<span class="badge" [attr.aria-label]="label">{{ count }}</span>`
})
export class OrderBadgeComponent {
  @Input() count = 0;

  get label(): string {
    return `${this.count} open orders`;
  }
}
