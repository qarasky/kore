import { AppMark, AuthScreen, Button } from "@qarasky/kore-ui";
import { useState } from "react";

function Art() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#111522]">
      <AppMark app="kore" size={200} className="opacity-80" />
    </div>
  );
}

/** #/auth (Kore: Kore ID + password), #/auth/error, #/auth/kore-id (Kore ID's own form), #/auth/no-access. */
export function AuthPage({ variant }: { variant?: string }) {
  const [error, setError] = useState<string | null>(
    variant === "error" ? "That email and password don't match. Try again, or ask your admin for a reset link." : null,
  );

  if (variant === "no-access") {
    return (
      <AuthScreen app="kore-id" title="You don't have access to KoreMind" description="Signed in as anna@northwind.example. Ask an admin to give you access.">
        <div className="flex flex-col gap-2">
          <Button variant="primary" fullWidth>
            Sign in as someone else
          </Button>
          <Button variant="ghost" fullWidth asChild>
            <a href="#/settings">Go to your account</a>
          </Button>
        </div>
      </AuthScreen>
    );
  }

  if (variant === "kore-id") {
    return (
      <AuthScreen
        app="kore-id"
        description="Use the account your admin created for you."
        notice="Sign in to continue to KoreCalendar."
        error={error}
        password={{
          invalid: !!error,
          hint: "Forgot it? Ask your admin for a reset link.",
          onSubmit: async () => {
            await new Promise((r) => setTimeout(r, 700));
            setError("That email and password don't match. Try again.");
          },
        }}
      />
    );
  }

  return (
    <AuthScreen
      app="kore"
      description="Use your Kore ID, or the password for this server."
      sso={{ href: "#/app" }}
      error={error}
      password={{
        invalid: !!error,
        defaultEmail: variant === "error" ? "anna@northwind.example" : undefined,
        onSubmit: async () => {
          await new Promise((r) => setTimeout(r, 700));
          setError("That email and password don't match. Try again, or ask your admin for a reset link.");
        },
      }}
      footer={<a href="#/components" className="hover:text-text">Back to components</a>}
      aside={<Art />}
    />
  );
}
