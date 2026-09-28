# Restaurant Ordering Platform

A reusable multi-restaurant online ordering platform for small food businesses.

## Project Goal

Customers can browse a restaurant menu, place an order, choose pickup or delivery, and pay online or with cash. Restaurants manage orders in real time, configure their delivery area and fees, and use their own drivers for nearby deliveries.

## Current MVP Scope

- Customer ordering website
- Pickup and restaurant-driver delivery
- Configurable delivery distance and fees
- Third-party courier option for addresses outside the restaurant delivery zone
- Online and cash payment flows
- Real-time restaurant/kitchen order management
- Restaurant menu/product management
- Multi-restaurant architecture
- Reusable shared Header and Footer
- No hard-coded restaurant branding or business data
- POS integration is optional and not required for MVP

## Development Rules

- Use CRUD patterns where applicable.
- Build reusable components instead of duplicating UI code.
- Shared Header/Footer/layouts must be reusable components.
- Restaurant-specific data must come from configuration/database, not hard-coded page content.
- Keep UI, business logic, data access, and configuration separated.
- Keep commits focused on one logical change.
- Every development commit must be accompanied by a file-change report so the changes can be verified before testing.

## Documentation

The project checklist and decision log are maintained under `docs/`.
