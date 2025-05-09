/**
 * @fileoverview Authentication controller for the My Profile platform.
 * Implements authentication and authorization endpoints following OAuth 2.0 principles
 * and industry security best practices.
 *
 * @package myprofile
 * @module auth
 *
 * This controller handles all authentication-related operations including:
 * - User registration and verification
 * - Login and session management
 * - Password reset flows
 * - Two-factor authentication (2FA)
 * - Social authentication
 * - Token management (access/refresh)
 * - Session tracking and security
 *
 * Core Security Features:
 * - Rate limiting on sensitive endpoints
 * - IP and device tracking
 * - Brute force prevention
 * - Session invalidation
 * - Token rotation
 * - Activity logging
 *
 * Key Dependencies:
 * - auth.service.ts: Core authentication logic
 * - email.service.ts: Email notifications
 * - twoFactor.service.ts: 2FA implementation
 * - whatsapp.service.ts: OTP via WhatsApp
 *
 * Architecture:
 * - Follows Controller-Service pattern
 * - Implements stateless authentication
 * - Uses JWT for token-based auth
 * - Supports multiple 2FA methods
 *
 * Error Handling:
 * - Comprehensive error logging
 * - Secure error responses
 * - Rate limit monitoring
 * - Failed attempt tracking
 *
 * Performance Considerations:
 * - Connection pooling
 * - Response caching where appropriate
 * - Asynchronous operations
 * - Optimized token validation
 *
 * @see {@link https://tools.ietf.org/html/rfc6749} OAuth 2.0 Spec
 * @see {@link https://tools.ietf.org/html/rfc7519} JWT Spec
 * @see {@link https://cloud.google.com/apis/design/errors} Google API Design Guide
 */

import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { logger } from "../utils/logger";
import { CustomError } from "../utils/errors";
import { User } from "../models/User"; // Added User import
import EmailService from "../services/email.service";
import { randomBytes } from "crypto";
import { config } from "../config/config";
import TwoFactorService from "../services/twoFactor.service";
import {
  registerSchema,
  loginSchema,
} from "../types/auth.types";
import WhatsAppService from "../services/whatsapp.service";
import { getClientInfo } from "../utils/controllerUtils";
import TwilioService from "../services/twilio.service";

/**
 * Core user interface defining essential user properties.
 * Used throughout the authentication flow for type safety and
 * data consistency.
 *
 * @interface User
 * @property {string} id - Unique user identifier
 * @property {string} email - User's email address
 * @property {string} fullName - User's full name
 * @property {string} username - User's chosen username
 *
 * Usage:
 * ```typescript
 * const user: User = {
 *   id: '123',
 *   email: 'user@example.com',
 *   fullName: 'John Doe',
 *   username: 'johndoe'
 * };
 * ```
 */
interface User {
  id: string;
  email: string;
  fullName: string;
  username: string;
}

/**
 * Extends Express Request to include authenticated user data.
 * This modification enables TypeScript to recognize the user object
 * that gets attached to requests by authentication middleware.
 *
 * @namespace Express
 * @interface Request
 * @property {User} [user] - Authenticated user data
 *
 * Usage:
 * ```typescript
 * app.get('/profile', (req: Request, res: Response) => {
 *   const user = req.user; // TypeScript knows this exists
 * });
 * ```
 */
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * Authentication Controller Class
 *
 * Implements comprehensive authentication and authorization functionality
 * following security best practices and OAuth 2.0 principles.
 *
 * Core Features:
 * - User registration with validation
 * - Multi-factor authentication
 * - Secure session management
 * - Password reset flows
 * - Social authentication
 * - Token-based authentication
 * - Security monitoring
 *
 * Security Measures:
 * - Rate limiting on sensitive endpoints
 * - IP and device tracking
 * - Brute force prevention
 * - Session invalidation
 * - Token rotation
 * - Activity logging
 *
 * Implementation Notes:
 * 1. All passwords are hashed using bcrypt
 * 2. Tokens are signed with RS256
 * 3. Sessions tracked with device info
 * 4. All operations are logged
 * 5. Errors handled securely
 *
 * Example Usage:
 * ```typescript
 * // In routes/auth.routes.ts
 * router.post('/register', AuthController.register);
 * router.post('/login', AuthController.login);
 * router.post('/logout', AuthController.logout);
 * ```
 */

// Define a User type with the required properties
interface User {
  id: string;
  email: string;
  fullName: string;
  username: string;
}

// Extend the Express Request interface to include the user property
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export class AuthController {
  /**
   * Register a new user
   * @route POST /auth/register
   */
  static async register(req: Request, res: Response) {
    try {
      // Validate request body against schema
      const validatedData = await registerSchema.parseAsync(req.body);

      // Register user using auth service
      const plainPhoneNumber = validatedData.phoneNumber.replace(/[^+\d]/g, "");

      const user: any = {
        email: validatedData.email,
        password: validatedData.password,
        fullName: validatedData.fullName,
        username: validatedData.username,
        dateOfBirth: validatedData.dateOfBirth,
        countryOfResidence: validatedData.countryOfResidence,
        phoneNumber: plainPhoneNumber, // Store the plain phone number
        formattedPhoneNumber: validatedData.phoneNumber, // Store the formatted phone number
        accountType: validatedData.accountType,
        accountCategory: validatedData.accountCategory,
        verificationMethod: validatedData.verificationMethod,
        isEmailVerified: false, // Default value
        isPhoneVerified: false, // Default value
        verificationData: {}, // Provide appropriate data structure
        refreshTokens: [], // Default value
        lastLogin: new Date(), // Optional
        failedLoginAttempts: 0, // Default value
        lockUntil: new Date(Date.now() + 60 * 60 * 1000), // Default value
        role: "user", // Default value
        subscription: {}, // Provide appropriate data structure
        address: {}, // Added missing property
        documents: [], // Added missing property
        twoFactorAuth: {}, // Added missing property
        profilePicture: "", // Added missing property
        coverPicture: "", // Added missing property
        followers: [], // Added missing property
        following: [], // Added missing property
        notifications: [], // Added missing property
        deviceInfo: {}, // Added missing property
        loginHistory: [], // Added missing property
        securityQuestions: [], // Added missing property
      };
      const clientInfo = await getClientInfo(req);
      console.log("🔐 Registration request from:", clientInfo.ip, clientInfo.os);

      // Check if referral code was provided
      const referralCode = validatedData.referralCode || undefined;

      const result: any = await AuthService.register(user, clientInfo.ip, clientInfo.os, referralCode);

      // Return the response
      res.status(201).json({
        success: true,
        message: "Registration successful. Please verify your email.",
        userId: result.user._id,
        verificationMethod: validatedData.verificationMethod,
        otpRequired: true,
        otpChannel: validatedData.verificationMethod.toLowerCase(),
      });
    } catch (error) {
      logger.error("Registration error:", error);
      res
        .status(error instanceof CustomError ? (error.statusCode ?? 400) : 400)
        .json({
          success: false,
          message:
            error instanceof Error ? error.message : "Registration failed",
        });
    }
  }

  /**
   * Authenticate user and create secure session with token-based authentication
   *
   * @route POST /api/auth/login
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @security
   * - Rate limiting to prevent brute force
   * - HTTP-only secure cookies
   * - Secure token rotation
   * - Device fingerprinting
   * - IP tracking
   * - Failed attempts monitoring
   *
   * @returns {Promise<void>} JSON response with login status and tokens
   *
   * @example
   * ```typescript
   * // Request body
   * {
   *   "email": "user@example.com",
   *   "password": "securePassword123"
   * }
   *
   * // Success Response
   * {
   *   "success": true,
   *   "user": {
   *     "id": "user_id",
   *     "email": "user@example.com",
   *     "fullName": "John Doe"
   *   },
   *   "tokens": {
   *     "accessToken": "...",
   *     "refreshToken": "..."
   *   }
   * }
   *
   * // Error Response
   * {
   *   "success": false,
   *   "message": "Invalid credentials"
   * }
   * ```
   */
  static async login(req: Request, res: Response) {
    try {
      const validatedData = await loginSchema.parseAsync(req.body);
      const { identifier, password } = validatedData;

      const result = await AuthService.login({ identifier, password }, req);

      console.log("🚀 ~ AuthController ~ login ~ result:", result)
      if (result.success == false) {
        res.status(401).json({
          success: false,
          user: {
            id: result.userId,
          },
          message: "Invalid credentials",
        });
        return;
      }

      // Generate tokens
      // Fetch user to get email
      const user = await User.findById(result.userId).select('email');
      if (!user) {
        throw new Error('User not found');
      }
      const tokens = AuthService.generateTokens(result.userId!, user.email);

      // Get client info for session tracking
      const clientInfo = await getClientInfo(req);

      // Store session information
      const userDoc = await User.findById(result.userId);
      if (userDoc) {
        // Initialize sessions array if it doesn't exist
        if (!userDoc.sessions) {
          userDoc.sessions = [];
        }

        // Add refresh token to sessions with device info
        userDoc.sessions.push({
          refreshToken: tokens.refreshToken,
          deviceInfo: {
            userAgent: req.headers['user-agent'] || 'Unknown',
            ip: req.ip || req.socket.remoteAddress || 'Unknown',
            deviceType: clientInfo.device || 'Unknown'
          },
          lastUsed: new Date(),
          createdAt: new Date(),
          isActive: true
        });

        // Limit the number of sessions to 10
        if (userDoc.sessions.length > 10) {
          // Sort by lastUsed (most recent first) and keep only the 10 most recent
          userDoc.sessions.sort((a: any, b: any) =>
            new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
          );
          userDoc.sessions = userDoc.sessions.slice(0, 10);
        }

        // Update last login time
        userDoc.lastLogin = new Date();

        await userDoc.save();
      }

      // Set tokens in HTTP-only cookies with proper settings
      res.cookie("accesstoken", tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // Use 'none' in production for cross-site requests
        path: "/",
        maxAge: 1 * 60 * 60 * 1000, // 1 hour
        domain: process.env.NODE_ENV === "production" ? process.env.COOKIE_DOMAIN : undefined
      });

      res.cookie("refreshtoken", tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // Use 'none' in production for cross-site requests
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        domain: process.env.NODE_ENV === "production" ? process.env.COOKIE_DOMAIN : undefined
      });
      console.log(user);

      res.status(200).json({
        success: true,
        user: {
          id: result.userId,
        },
        message: "Login successful",
      });


    } catch (error) {
      logger.error("Login error:", error);
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Login failed",
      });
    }
  }

  // static async login(req: Request, res: Response) {
  //   try {
  //     const validatedData = await loginSchema.parseAsync(req.body);
  //     const result = await AuthService.login(validatedData, req);

  //     // Set tokens in HTTP-only cookies
  //     if (result.tokens) {
  //       console.log("🍪 Setting auth cookies...");
  //       res.cookie("accesstoken", result.tokens.accessToken, {
  //         httpOnly: true,
  //         secure: process.env.NODE_ENV === "production",
  //         sameSite: "lax",
  //         path: "/",
  //         maxAge: 15 * 60 * 1000, // 15 minutes
  //       });

  //       res.cookie("refreshtoken", result.tokens.refreshToken, {
  //         httpOnly: true,
  //         secure: process.env.NODE_ENV === "production",
  //         sameSite: "lax",
  //         path: "/",
  //         maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  //       });
  //       console.log("✅ Auth cookies set successfully");
  //     }

  //     res.json(result);
  //   } catch (error) {
  //     logger.error("Login error:", error);
  //     res.status(400).json({
  //       success: false,
  //       message: error instanceof Error ? error.message : "Login failed",
  //     });
  //   }
  // }


  /**
   * Get active sessions for the authenticated user
   *
   * @route GET /api/auth/sessions
   * @param {Request} req Express request object with authenticated user
   * @param {Response} res Express response object
   *
   * @security
   * - Requires valid authentication
   * - Validates user session
   * - Only returns sessions for authenticated user
   *
   * @returns {Promise<void>} JSON response with active sessions
   *
   * @example
   * ```typescript
   * // Success Response
   * {
   *   "success": true,
   *   "sessions": [
   *     {
   *       "deviceInfo": {
   *         "browser": "Chrome",
   *         "os": "Windows",
   *         "ip": "192.168.1.1"
   *       },
   *       "lastActive": "2025-02-08T22:13:31.000Z",
   *       "location": "San Francisco, US",
   *       "status": "active"
   *     }
   *   ]
   * }
   * ```
   */
  static async getSessions(req: Request, res: Response) {
    try {
      const user: any = req.user;
      const sessions = await AuthService.getUserSessions(user._id);
      res.json({ success: true, sessions });
    } catch (error) {
      logger.error("Get sessions error:", error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to get sessions",
      });
    }
  }

  /**
   * Logout user from all active sessions and devices
   *
   * @route POST /api/auth/logout-all
   * @param {Request} req Express request object with authenticated user
   * @param {Response} res Express response object
   *
   * @security
   * - Requires valid authentication
   * - Invalidates all refresh tokens
   * - Clears all HTTP-only cookies
   * - Logs security event with device info
   * - Updates user's session history
   *
   * @returns {Promise<void>} JSON response with logout status
   *
   * @example
   * ```typescript
   * // Success Response
   * {
   *   "success": true,
   *   "message": "Logged out from all sessions"
   * }
   *
   * // Error Response
   * {
   *   "success": false,
   *   "message": "Failed to logout from all sessions"
   * }
   * ```
   */
  static async logoutAll(req: Request, res: Response) {
    try {
      const user: any = req.user;
      await AuthService.logout(user._id, ""); // Pass empty refresh token to clear all tokens

      // Clear auth cookies
      console.log("🗑️  Clearing auth cookies for all sessions...");
      res.clearCookie("accesstoken");
      res.clearCookie("refreshtoken");
      console.log("✅ Auth cookies cleared successfully for all sessions");

      res.json({ success: true, message: "Logged out from all sessions" });
    } catch (error) {
      logger.error("Logout all error:", error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to logout from all sessions",
      });
    }
  }

  /**
   * Verify One-Time Password (OTP) for account verification
   *
   * @route POST /api/auth/verify-otp
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @security
   * - OTP expiration validation
   * - Max attempts limit
   * - Time-based throttling
   * - Device fingerprinting
   * - IP tracking
   * - Concurrent verification prevention
   *
   * @returns {Promise<void>} JSON response with verification status and tokens
   *
   * @example
   * ```typescript
   * // Request body
   * {
   *   "_id": "user_id",
   *   "otp": "123456",
   *   "verificationMethod": "email" // or "phone"
   * }
   *
   * // Success Response
   * {
   *   "success": true,
   *   "message": "OTP verified successfully",
   *   "user": {
   *     "id": "user_id",
   *     "email": "user@example.com",
   *     "isVerified": true
   *   },
   *   "tokens": {
   *     "accessToken": "...",
   *     "refreshToken": "..."
   *   }
   * }
   *
   * // Error Response
   * {
   *   "success": false,
   *   "message": "Invalid OTP or OTP expired"
   * }
   * ```
   */
  static async verifyOTP(req: Request, res: Response) {
    try {
      const { _id, otp, verificationMethod, issue } = req.body;
      const motive = req.body.motive || "login"; // Default to "login"

      if (!_id || !otp || !verificationMethod) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: _id, otp, or verificationMethod",
        });
      }

      // Call the verifyOTP method
      const result = await AuthService.verifyOTPResponse(
        _id,
        otp,
        verificationMethod.toLowerCase()
      );

      if (result.success) {
        const user = result.user;

        // Handle different verification purposes
        switch (issue) {
          case "forgot_username":
            return res.json({
              success: true,
              message: "Username retrieved successfully",
              username: user?.username
            });

          case "forgot_email":
            return res.json({
              success: true,
              message: "Email retrieved successfully",
              email: user?.email
            });

          case "forgot_password":
            // For password reset, we still need to let them set a new password
            return res.json({
              success: true,
              message: "OTP verified successfully. You can now reset your password.",
              email: user?.email
            });

          case "phone_number_change":
          case "email_change":
            // For changes, we verify their identity first, then they can make the change
            return res.json({
              success: true,
              message: "Identity verified successfully. You can now make the requested change.",
              currentValue: issue === "phone_number_change" ? user?.phoneNumber : user?.email
            });

          default:
            // Handle regular login case
            if (motive === "login") {
              const tokens = AuthService.generateTokens(_id, user!.email);

              res.cookie("accesstoken", tokens.accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                path: "/",
                maxAge: 1 * 60 * 60 * 1000, // 1 hour
              });

              res.cookie("refreshtoken", tokens.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 30 * 24 * 60 * 60 * 1000,
              });

              return res.json({
                success: true,
                message: "OTP verified successfully",
                tokens,
                user: {
                  _id: user?._id,
                  email: user?.email,
                  username: user?.username,
                  fullname: user?.fullName,
                }
              });
            }

            return res.json({
              success: true,
              message: "OTP verified successfully"
            });
        }
      }

      return res.status(400).json({
        success: false,
        message: result.message || "Invalid OTP",
      });
    } catch (error) {
      logger.error("OTP verification error:", error);
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to verify OTP",
      });
    }
  }


  /**
   * Refresh user's access token using a valid refresh token
   *
   * @route POST /api/auth/refresh-token
   * @param {Request} req Express request object with refresh token in cookie or body
   * @param {Response} res Express response object
   *
   * @security
   * - Validates refresh token
   * - Implements token rotation
   * - Sets secure HTTP-only cookies
   * - Tracks token usage
   * - Prevents token reuse
   * - Updates session activity
   *
   * @returns {Promise<void>} JSON response with new token pair
   *
   * @example
   * ```typescript
   * // Success Response
   * {
   *   "success": true,
   *   "tokens": {
   *     "accessToken": "new-access-token",
   *     "refreshToken": "new-refresh-token"
   *   }
   * }
   *
   * // Error Response
   * {
   *   "success": false,
   *   "message": "Invalid refresh token"
   * }
   * ```
   */
  static async refreshToken(req: Request, res: Response) {
    try {
      const refreshToken = req.cookies.refreshtoken || req.body.refreshToken;
      if (!refreshToken) {
        throw new CustomError("MISSING_TOKEN", "Refresh token is required");
      }

      // Get request info for security tracking
      const clientInfo = await getClientInfo(req);

      // Extract device information for session tracking
      const deviceInfo = {
        userAgent: req.headers['user-agent'] || 'Unknown',
        ip: req.ip || req.socket.remoteAddress || 'Unknown',
        deviceType: clientInfo.device || 'Unknown'
      };

      // Call AuthService to handle token refresh with device info
      const tokens = await AuthService.refreshAccessToken(refreshToken, deviceInfo);

      // Set new tokens in cookies
      res.cookie("accesstoken", tokens.accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 1 * 60 * 60 * 1000, // 1 hour (matches JWT_ACCESS_EXPIRATION)
      });

      res.cookie("refreshtoken", tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days (matches JWT_REFRESH_EXPIRATION)
      });
      console.log("✅ Token rotation completed successfully");

      // Send response
      res.json({
        success: true,
        message: "Tokens refreshed successfully",
        tokens
      });
    } catch (error) {
      logger.error("Token refresh error:", error);
      res.status(401).json({
        success: false,
        message: error instanceof Error ? error.message : "Token refresh failed",
      });
    }
  }

  /**
   * Logout user
   * @route POST /auth/logout
   */
  static async logout(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;
      const user: any = req.user;

      await AuthService.logout(user._id, refreshToken);

      // Clear auth cookies
      console.log("🗑️  Clearing auth cookies...");
      res.clearCookie("accesstoken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      res.clearCookie("refreshtoken", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      console.log("✅ Auth cookies cleared successfully");

      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      logger.error("Logout error:", error);
      res.status(400).json({
        success: false,
        message: error instanceof Error ? error.message : "Logout failed",
      });
    }
  }

  /**
   * Request password reset
   * @route POST /auth/forgot-password
   */
  static async forgotPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) {
        throw new CustomError("MISSING_EMAIL", "Email is required");
      }

      // Fetch user first to ensure email exists and get name
      const user = await User.findOne({ email }).select('fullName');

      // Always return success message for security, even if user not found
      // But only proceed if user exists
      if (user) {
        const resetToken = randomBytes(32).toString("hex");
        await AuthService.setResetToken(email, resetToken, 'reset_password', 'email');

        const clientInfo = await getClientInfo(req);

        // Define expiry time (e.g., 60 minutes)
        const expiryMinutes = 60;

        // Send reset email with properly encoded token
        const encodedToken = encodeURIComponent(resetToken);

        // Make sure we have a valid CLIENT_URL, with fallback to the hardcoded production URL
        const clientUrl = config.CLIENT_URL || 'https://my-pts-dashboard-management.vercel.app';
        const resetUrl = `${clientUrl}/reset-password?token=${encodedToken}`;

        logger.info(`Generated reset URL in auth controller: ${resetUrl}`);

        await EmailService.sendPasswordResetEmail(
          email,
          resetUrl, // Pass the full URL
          user.fullName || 'User', // Pass user's name (or default)
          expiryMinutes, // Pass expiry time
          { ipAddress: clientInfo.ip, userAgent: clientInfo.os }
        );
      } else {
        // Log if user not found, but don't reveal this to the client
        logger.warn(`Password reset requested for non-existent email: ${email}`);
      }

      res.json({
        success: true,
        message:
          "If an account exists with this email, password reset instructions have been sent", // Kept generic for security
      });
    } catch (error) {
      logger.error("Forgot password error:", error);
      // Use vague message for security
      res.status(200).json({
        success: true,
        message:
          "If an account exists with this email, password reset instructions have been sent",
      });
    }
  }

  /**
   * Reset password using a valid reset token
   *
   * @route POST /api/auth/reset-password
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @security
   * - Validates token expiration
   * - Enforces password strength
   * - Rate limiting on attempts
   * - IP tracking for suspicious activity
   * - Secure token validation
   * - Password history check
   *
   * @returns {Promise<void>} JSON response with reset status
   *
   * @example
   * ```typescript
   * // Request body
   * {
   *   "token": "reset-token-here",
   *   "password": "newSecurePassword123"
   * }
   *
   * // Success Response
   * {
   *   "success": true,
   *   "message": "Password reset successful"
   * }
   *
   * // Error Response
   * {
   *   "success": false,
   *   "message": "Invalid or expired reset token"
   * }
   * ```
   */
  static async resetPassword(req: Request, res: Response) {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        throw new CustomError(
          "MISSING_FIELDS",
          "Token and password are required"
        );
      }

      await AuthService.resetPassword(token, password, 'reset_password');
      res.json({
        success: true,
        message: "Password reset successful",
      });
    } catch (error) {
      logger.error("Reset password error:", error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Password reset failed",
      });
    }
  }

  /**
   * Resend verification email
   * @route POST /auth/resend-verification
   */
  static async resendVerification(req: Request, res: Response) {
    try {
      const { email } = req.body;
      if (!email) {
        throw new CustomError("MISSING_EMAIL", "Email is required");
      }

      const clientInfo = await getClientInfo(req);

      // Logic to resend verification email
      const result = await AuthService.resendVerification(email);
      res.json({
        success: true,
        message: "Verification email resent successfully",
      });
    } catch (error) {
      logger.error("Resend verification error:", error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to resend verification email",
      });
    }
  }

  /**
   * Verify user email address
   *
   * @route POST /api/auth/verify-email
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @security
   * - Validates verification token
   * - Rate limiting protection
   * - Token expiration check
   * - IP tracking for suspicious activity
   * - One-time use tokens
   * - Secure session creation
   *
   * @returns {Promise<void>} JSON response with verification status
   *
   * @example
   * ```typescript
   * // Request body
   * {
   *   "token": "verification-token-here"
   * }
   *
   * // Success Response
   * {
   *   "success": true,
   *   "message": "Email verified successfully"
   * }
   *
   * // Error Response
   * {
   *   "success": false,
   *   "message": "Invalid verification token"
   * }
   * ```
   */
  static async verifyEmail(req: Request, res: Response) {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Verification token is required"
        });
      }

      // Get request info for security tracking
      const clientInfo = await getClientInfo(req);

      // First find user by verification token
      const user: any = await User.findOne({ 'verificationData.token': token });
      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid verification token"
        });
      }

      // Validate the token using AuthService
      const result = await AuthService.verifyEmail(token);

      if (result.success) {
        // Generate tokens
        const tokens = await AuthService.generateTokens(user.email, user._id);

        // Set access token cookie
        res.cookie("accesstoken", tokens.accessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 24 * 60 * 60 * 1000, // 24 hours (matches JWT_ACCESS_EXPIRATION)
        });

        // Send success response
        return res.status(200).json({
          success: true,
          message: "Email verified successfully"
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message || "Email verification failed"
      });
    } catch (error) {
      logger.error("Email verification error:", error);
      res.status(500).json({
        success: false,
        message: "An error occurred during email verification"
      });
    }
  }

  /**
   * Generate Two-Factor Authentication (2FA) secret for user
   *
   * @route POST /api/auth/generate-2fa
   * @param {Request} req Express request object with authenticated user
   * @param {Response} res Express response object
   *
   * @security
   * - Requires authentication
   * - Validates user session
   * - Generates cryptographically secure secret
   * - QR code generation for authenticator apps
   * - Email notification with setup instructions
   * - Device tracking for audit
   *
   * @returns {Promise<void>} JSON response with 2FA setup data
   *
   * @example
   * ```typescript
   * // Request header
   * Authorization: Bearer <access_token>
   *
   * // Success Response
   * {
   *   "message": "2FA code sent successfully",
   *   "qrCode": "data:image/png;base64,..." // QR code for authenticator app
   * }
   *
   * // Error Response
   * {
   *   "message": "User not authenticated",
   *   "statusCode": 401
   * }
   * ```
   */
  static async generate2FA(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      const user = req.user as any;
      const userId = user._id;

      // Generate 2FA secret
      const secretData = await TwoFactorService.generateSecret(userId);

      // Get request info for security tracking
      const clientInfo = await getClientInfo(req);

      // Send 2FA code via email with security info
      await EmailService.sendTwoFactorAuthEmail(user.email, secretData.secret, { ipAddress: clientInfo.ip, userAgent: clientInfo.os });

      res.status(200).json({
        message: "2FA code sent successfully",
        qrCode: secretData.qrCode
      });
    } catch (error) {
      logger.error("Error generating 2FA:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }

  /**
   * Verify 2FA code submitted by user
   *
   * @route POST /api/auth/verify-2fa
   * @param {Request} req Express request object with authenticated user
   * @param {Response} res Express response object
   *
   * @security
   * - Requires authentication
   * - Time-based code validation
   * - Rate limiting per user
   * - Invalid attempts tracking
   * - Session validation
   * - Device fingerprinting
   *
   * @returns {Promise<void>} JSON response with verification status
   *
   * @example
   * ```typescript
   * // Request body
   * {
   *   "code": "123456"
   * }
   *
   * // Success Response
   * {
   *   "message": "2FA code verified successfully"
   * }
   *
   * // Error Response
   * {
   *   "message": "Invalid 2FA code"
   * }
   * ```
   */
  static async verify2FA(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      const { code } = req.body;
      const user = req.user as any;
      const userId = user._id; // Assuming user is authenticated
      const isValid = await TwoFactorService.verifyToken(userId, code);
      if (isValid) {
        res.status(200).json({ message: "2FA code verified successfully" });
      } else {
        res.status(400).json({ message: "Invalid 2FA code" });
      }
    } catch (error) {
      logger.error("Error verifying 2FA:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }

  /**
   * Disable 2FA
   * @route POST /auth/disable-2fa
   */
  static async disable2FA(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      const user = req.user as any;
      const userId = user._id; // Assuming user is authenticated
      await TwoFactorService.disable(userId);
      res.status(200).json({ message: "2FA disabled successfully" });
    } catch (error) {
      logger.error("Error disabling 2FA:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }

  /**
   * Validate 2FA code
   * @route POST /auth/validate-2fa
   */
  static async validate2FA(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "User not authenticated" });
      }
      const { code } = req.body;
      const user = req.user as any;
      const userId = user._id; // Assuming user is authenticated

      const isValid = await TwoFactorService.verifyToken(userId, code);
      if (isValid) {
        res.status(200).json({ message: "2FA code is valid" });
      } else {
        res.status(400).json({ message: "Invalid 2FA code" });
      }
    } catch (error) {
      logger.error("Error validating 2FA:", error);
      res.status(500).json({ message: "Internal Server Error" });
    }
  }

  /**
   * Resend OTP
   * @route POST /auth/resend-otp
   */
  static async resendOTP(req: Request, res: Response) {
    try {
      const { _id, verificationMethod } = req.body;

      if (!_id || !verificationMethod) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: _id",
        });
      }

      if (_id.length !== 24) {
        return res.status(400).json({
          success: false,
          message: "Invalid user ID",
        });
      }

      // Find user
      const user = await User.findById(_id);
      if (!user) {
        return res.status(400).json({
          success: false,
          message: "User not found",
        });
      }



      user.verificationMethod = verificationMethod;

      // Generate new OTP
      const otp = generateOTP(6);

      console.log("🔐 Resending OTP:", otp);

      // Get request info for security tracking
      const clientInfo = await getClientInfo(req);

      // Update user's verification data
      user.verificationData = {
        otp,
        otpExpiry: new Date(
          Date.now() + AuthService.OTP_EXPIRY_MINUTES * 60 * 1000
        ),
        attempts: 0,
        lastAttempt: new Date(),
      };

      await user.save();

      // Send OTP based on verification method
      if (user.verificationMethod.toLowerCase() === "email") {
        await EmailService.sendVerificationEmail(user.email, otp, { ipAddress: clientInfo.ip, userAgent: clientInfo.os });
        logger.info(`🟣 Registration OTP (Email): ${otp}`);
      } else if (
        user.verificationMethod.toLowerCase() === "phone" &&
        user.phoneNumber
      ) {
        console.log("Sending OTP to phone number:", user.phoneNumber);
        await TwilioService.sendOTPMessage(user.phoneNumber, otp);
        logger.info(`🟣 Registration OTP (Phone): ${otp}`);
      }

      res.json({
        success: true,
        message: `OTP resent successfully via ${user.verificationMethod}:  ${user.verificationMethod.toLowerCase() === "phone" ? user.phoneNumber : user.email} `,
        userId: user._id,
        otp: otp
      });
    } catch (error) {
      logger.error("Resend OTP error:", error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to resend OTP",
      });
    }
  }

  static async selectOTPMethod(req: Request, res: Response) {
    try {
      const { _id, verificationMethod } = req.body;

      if (!_id || !verificationMethod) {
        return res.status(400).json({
          success: false,
          message: "Missing required fields: _id or verificationMethod",
        });
      }

      // Find user
      const user = await User.findById(_id);
      if (!user) {
        return res.status(400).json({
          success: false,
          message: "User not found",
        });
      }

      // Update user's verification data
      user.verificationMethod = verificationMethod;

      await user.save();

      // Send OTP based on verification method

      res.json({
        success: true,
        message: `OTP verification method sent,  ${verificationMethod}`,
        userId: user._id,
      });
    } catch (error) {
      logger.error("Error sending OPT verification method:", error);
      res.status(400).json({
        success: false,
        message:
          error instanceof Error ? error.message : "Failed to send OTP verification method",
      });
    }
  }

  /**
   * Check if an email address is available (not already registered)
   *
   * @route GET /api/auth/check-email/:email
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} JSON response indicating if email is available
   */
  static async checkEmail(req: Request, res: Response) {
    try {
      const email = req.params.email;
      const user = await User.findOne({ email: email.toLowerCase() });

      res.json({
        available: !user,
        message: user ? 'Email is already registered' : 'Email is available'
      });
    } catch (error) {
      logger.error('Check email error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check email availability'
      });
    }
  }

  /**
   * Check if a username is available (not already taken)
   *
   * @route GET /api/auth/check-username/:username
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} JSON response indicating if username is available
   */
  static async checkUsername(req: Request, res: Response) {
    try {
      const username = req.params.username;
      const user = await User.findOne({ username: username.toLowerCase() });

      res.json({
        available: !user,
        message: user ? 'Username is already taken' : 'Username is available'
      });
    } catch (error) {
      logger.error('Check username error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to check username availability'
      });
    }
  }

  /**
   * Retrieve forgotten information (email/username) after OTP validation
   * @route POST /auth/retrieve-forgotten-info
   */
  static async retrieveForgottenInfo(req: Request, res: Response) {
    try {
      const { token, infoType } = req.body;

      if (!token || !infoType) {
        return res.status(400).json({
          success: false,
          message: "Token and infoType are required"
        });
      }

      // Validate infoType
      if (!['email', 'username', 'phone_number'].includes(infoType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid infoType. Must be 'email', 'username', or 'phone_number'"
        });
      }

      const result = await AuthService.retrieveForgottenInfo(token, infoType);

      if (result.success && result.info) {
        return res.json({
          success: true,
          message: `Your ${infoType} has been retrieved successfully`,
          [infoType]: result.info
        });
      }

      return res.status(400).json({
        success: false,
        message: result.message || "Failed to retrieve information"
      });
    } catch (error) {
      logger.error("Error retrieving forgotten info:", error);
      return res.status(500).json({
        success: false,
        message: "Error retrieving information"
      });
    }
  }

  /**
   * Handle trouble logging in by providing personalized assistance
   *
   * @route POST /api/auth/trouble-login
   * @param {Request} req Express request object
   * @param {Response} res Express response object
   *
   * @returns {Promise<void>} JSON response with helpful next steps
   */
  static async troubleLogin(req: Request, res: Response): Promise<Response> {
    try {
      const { identifier, issue, verificationMethod } = req.body;

      // Validate request payload
      if (!identifier) {
        return res.status(400).json({
          success: false,
          message: "Identifier (email, username, or phone) is required",
        });
      }

      if (!issue) {
        return res.status(400).json({
          success: false,
          message: "Issue is required",
        });
      }

      // Find user based on identifier
      const user = await User.findOne({
        $or: [
          { email: identifier.toLowerCase() },
          { username: identifier.toLowerCase() },
          { phoneNumber: identifier },
        ],
      });

      if (!user) {
        return res.json({
          success: true,
          message:
            "If an account exists with this email, we'll send instructions to help you log in.",
          nextSteps: [
            "Check if you used the correct email address",
            "Try creating a new account if you haven't registered",
          ],
        });
      }

      // Function to get next steps based on issue
      const getNextSteps = (method: "EMAIL" | "PHONE", issue: string): string[] => {
        const commonSteps: { [key: string]: string[] } = {
          account_locked: [
            "Your account will automatically unlock after 1 hour",
            "Contact support if you need immediate assistance",
            "Enable 2FA to prevent future lockouts",
          ],
          "2fa_issues": [
            "Make sure your device's time is correctly synchronized",
            "Use backup codes if you've lost access to your authenticator app",
            "Contact support if you've lost access to your 2FA device",
          ],
          default: [
            "Ensure you're using the correct credentials",
            "Check if Caps Lock is on",
            "Reset your password if you can't remember it",
            "Contact support if you continue having problems",
          ],
        };

        if (issue === "forgot_password" || "forgot_username" || "forgot_email" || "phone_number_change" || "email_change") {
          return method === "EMAIL"
            ? [
              "Check your email for a verification code",
              "Enter the code to reset your password",
              "If you don't receive the email, check your spam folder",
            ]
            : [
              "Check your phone for a verification code",
              "Enter the code to reset your password",
              "If you don't receive the SMS, check your network signal",
            ];
        }

        return commonSteps[issue] || commonSteps.default;
      };

      // Function to handle password reset
      const handlePasswordReset = async (
        method: "EMAIL" | "PHONE",
        identifier: string
      ): Promise<string> => {
        const otp = generateOTP(6); // Generate 6-digit OTP
        const expiry = new Date(Date.now() + AuthService.OTP_EXPIRY_MINUTES * 60 * 1000);

        // Store OTP in user record
        user.verificationData = {
          otp,
          otpExpiry: expiry,
          attempts: 0,
          lastAttempt: new Date(),
        };
        await user.save();

        console.log("Updated user verification data:", user.verificationData);

        if (method.toLocaleLowerCase() === "email") {
          await EmailService.sendVerificationEmail(user.email, otp, {
            ipAddress: req.ip,
            userAgent: req.get("user-agent") || "unknown",
          });
          logger.info(`🔐 Password Reset OTP (Email): ${otp}`);
        } else {
          try {
            await TwilioService.sendOTPMessage(user.phoneNumber, otp);
            logger.info(`🔐 Password Reset OTP (SMS): ${otp}`);
          } catch (error) {
            logger.error("Failed to send OTP via Twilio", error);
            throw new Error("Unable to send OTP via SMS. Please try again.");
          }
        }

        return otp;
      };


      // Trigger password reset if necessary
      let otpSent = null;
      const resetIssues = ["forgot_password", "forgot_username", "forgot_email", "phone_number_change", "email_change"];
      if (resetIssues.includes(issue)) {
        otpSent = await handlePasswordReset(
          verificationMethod as "EMAIL" | "PHONE",
          identifier.toLowerCase()
        );
      }

      // Response with next steps
      return res.json({
        success: true,
        message: "We've identified some steps to help you log in",
        nextSteps: getNextSteps(verificationMethod as "EMAIL" | "PHONE", issue),
        userId: user._id,
        otpSent, // Include OTP in response only for testing/debugging (remove in production)
        supportEmail: config.SMTP_FROM,
        supportPhone: config.SUPPORT_PHONE,
      });
    } catch (error) {
      logger.error("Trouble login error:", error);
      return res.status(500).json({
        success: false,
        message: "Error processing your request. Please try again later.",
      });
    }
  }

  /**
   * Change user's email address after verification
   * @route POST /auth/change-email
   */
  static async changeEmail(req: Request, res: Response) {
    try {
      const { userId, newEmail } = req.body;

      if (!userId || !newEmail) {
        return res.status(400).json({
          success: false,
          message: "User ID and new email are required"
        });
      }

      // Check if email is already in use
      const existingUser = await User.findOne({ email: newEmail, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Email is already in use"
        });
      }

      // Update user's email
      const user = await User.findByIdAndUpdate(
        userId,
        {
          email: newEmail,
          isEmailVerified: true // Since they've already verified through OTP
        },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      return res.json({
        success: true,
        message: "Email updated successfully",
        email: newEmail
      });
    } catch (error) {
      logger.error("Change email error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update email"
      });
    }
  }

  /**
   * Change user's phone number after verification
   * @route POST /auth/change-phone
   */
  static async changePhoneNumber(req: Request, res: Response) {
    try {
      const { userId, newPhoneNumber, formattedPhoneNumber } = req.body;

      if (!userId || !newPhoneNumber) {
        return res.status(400).json({
          success: false,
          message: "User ID and new phone number are required"
        });
      }

      // Check if phone number is already in use
      const existingUser = await User.findOne({ phoneNumber: newPhoneNumber, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Phone number is already in use"
        });
      }

      // Update user's phone number
      const user = await User.findByIdAndUpdate(
        userId,
        {
          phoneNumber: newPhoneNumber,
          formattedPhoneNumber: formattedPhoneNumber || newPhoneNumber,
          isPhoneVerified: true // Since they've already verified through OTP
        },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      return res.json({
        success: true,
        message: "Phone number updated successfully",
        phoneNumber: newPhoneNumber,
        formattedPhoneNumber: formattedPhoneNumber || newPhoneNumber
      });
    } catch (error) {
      logger.error("Change phone number error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update phone number"
      });
    }
  }

  /**
   * Change username after verification
   * @route POST /auth/change-username
   */
  static async changeUsername(req: Request, res: Response) {
    try {
      const { userId, newUsername } = req.body;

      if (!userId || !newUsername) {
        return res.status(400).json({
          success: false,
          message: "User ID and new username are required"
        });
      }

      // Check if username is already in use
      const existingUser = await User.findOne({ username: newUsername.toLowerCase(), _id: { $ne: userId } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Username is already taken"
        });
      }

      // Update user's username
      const user = await User.findByIdAndUpdate(
        userId,
        { username: newUsername.toLowerCase() },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      return res.json({
        success: true,
        message: "Username updated successfully",
        username: newUsername.toLowerCase()
      });
    } catch (error) {
      logger.error("Change username error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to update username"
      });
    }
  }
}

function generateOTP(length: number) {
  const digits = "0123456789";
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

export async function socialAuthCallback(req: Request, res: Response) {
  try {
    const { user, accessToken, refreshToken } = req.body;
    // Handle the returned user and tokens
    res.json({ success: true, user, accessToken, refreshToken });
    console.log(
      "🔑 Social auth callback successful:",
      user,
      accessToken,
      refreshToken
    );
  } catch (error) {
    logger.error("Social auth callback error:", error);
    res.status(400).json({
      statusCode: 200, // Successful response
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to authenticate with social provider",
    });
  }
}
