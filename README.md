# 🪐 Circilar Habit Tracker

**Habits** is a minimalist and secure habit tracker built with **React Native**. It leverages the **Nostr** protocol to synchronize your data across devices in a decentralized and fully encrypted manner.


---

## ✨ Key Features

* **Nostr Sync**: Your data is encrypted with your private key and stored across decentralized Nostr relays.
* **Dual Design**: A high-density Matrix table view optimized for mobile and a beautiful Circle view for desktop/tablet.
* **Dark Mode**: A sleek, adaptive interface (Slate/Zinc palette) for a premium look and feel.
* **Privacy First**: No central databases. No accounts. Your keys, your data.
* **Smart Syncing**: 3-second debouncing to minimize relay calls and optimize battery/data usage.
* **Auto-Focus**: Automatically scrolls to the current day on startup so you never lose your place.

## 🛠️ Tech Stack

- **React Native / Expo**
- **Nostr-tools** (NIP-04 Encrypted Events / Kind 30000)
- **React Native SVG** (For the circular visualization)
- **AsyncStorage** (Local persistence)

## 🚀 Getting Started

1. Clone the repository:
   ```bash
   git clone [https://github.com/avra911/Habit-Tracker-App](https://github.com/avra911/Habit-Tracker-App)
   ```
2. Install dependencies:
   ```bash
   npm install
   # or
   npx expo install
   ```
3. Install the required cryptography polyfills:
   ```bash
   npx expo install react-native-get-random-values expo-crypto
   ```
4. Start the application:
   ```bash
   npx expo start
   ```

## 🔐 Security & Privacy

The app uses **NIP-04** asymmetric encryption to ensure that only you can read the data sent to Nostr relays. No third-party server ever sees your habits or your private keys.

---
Created with ❤️ for the Nostr community.