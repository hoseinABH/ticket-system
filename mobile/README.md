# ✈️ Midnight Airways — Flight Booking Mobile App

A modern, high-performance React Native & Expo mobile app built for the Ticket System backend. Features an airline midnight theme, live flight search, 15-minute ephemeral fare quote lock via Redis, digital boarding passes with perforated cutout styling, and JWT authentication.

---

## 🛠 Tech Stack
- **Framework:** [Expo](https://expo.dev/) (SDK 58) + React Native 0.88 + React 19
- **Navigation:** [Expo Router](https://docs.expo.dev/router/introduction/) (File-based tab routing & modal sheets)
- **Styling:** [NativeWind v4](https://www.nativewind.dev/) (Tailwind CSS with airline midnight theme)
- **State Management:** [Zustand](https://github.com/pmndrs/zustand) (Client & Auth persistence via AsyncStorage)
- **Server Cache & Queries:** [TanStack React Query v5](https://tanstack.com/query)
- **Icons:** [lucide-react-native](https://lucide.dev/)
- **HTTP Client:** Axios with auto-bearer auth interceptors and dynamic localhost/LAN IP discovery

---

## 📱 How to Run on Your Mac (Both iOS & Android)

### Option 1: On Physical iPhone or Android (Easiest & Fastest ⭐)
You don't need Xcode or Android Studio installed on your Mac for this:
1. Download **Expo Go** from the iOS App Store or Google Play Store on your phone.
2. Make sure your phone is connected to the same Wi-Fi network as your Mac.
3. Start the dev server:
   ```bash
   cd ticket-system-mobile # or ../FE/ticket-system-mobile
   npx expo start
   ```
4. Scan the QR code shown in your terminal:
   - **iOS:** Open the default Camera app and tap the Expo banner.
   - **Android:** Open the Expo Go app and tap "Scan QR Code".

---

### Option 2: iOS Simulator on Mac
1. Ensure full **Xcode** is installed from the Mac App Store (Command Line Tools alone is not enough).
2. Open Xcode once to accept licenses and install iOS components:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
3. Open a simulator:
   ```bash
   open -a Simulator
   ```
4. Run:
   ```bash
   npx expo run:ios
   # or
   npx expo start --ios
   ```

---

### Option 3: Android Emulator on Mac
1. Download and install **[Android Studio](https://developer.android.com/studio)**.
2. Open Android Studio > **Virtual Device Manager** > Create a device (e.g., Pixel 8 with Google Play).
3. Ensure Android SDK tools are added to your shell path in `~/.zshrc`:
   ```bash
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/emulator
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```
4. Start your emulator, then run:
   ```bash
   npx expo start --android
   ```

---

### Option 4: Web Browser Preview
Run directly in your browser with mobile viewport:
```bash
npx expo start --web
```

---

## 🔌 Connecting to Backend & Seeding Data
The app automatically routes to `http://localhost:3000` (iOS/Web) or `http://10.0.2.2:3000` (Android emulator) or your Mac's LAN IP (Expo Go).

1. Ensure the NestJS backend is running:
   ```bash
   cd BE/ticket-system
   pnpm run start:dev
   ```
2. In the mobile app, tap **"Seed Sample Test Flights"** on the home screen to insert test routes (`THR → IST`).
3. Create an account or sign in via the **Passenger Sign In** sheet to lock quotes and checkout boarding passes.
