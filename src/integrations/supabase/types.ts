export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      admin_establishments: {
        Row: {
          admin_id: string;
          created_at: string;
          establishment_id: string;
        };
        Insert: {
          admin_id: string;
          created_at?: string;
          establishment_id: string;
        };
        Update: {
          admin_id?: string;
          created_at?: string;
          establishment_id?: string;
        };
        Relationships: [];
      };
      establishments: {
        Row: {
          created_at: string;
          id: string;
          is_default: boolean;
          name: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      admins: {
        Row: {
          is_super: boolean;
          created_at: string;
          user_id: string;
        };
        Insert: {
          is_super?: boolean;
          created_at?: string;
          user_id: string;
        };
        Update: {
          is_super?: boolean;
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      board_links: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          round_id: string;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          revoked_at?: string | null;
          round_id: string;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          round_id?: string;
          token_hash?: string;
        };
        Relationships: [];
      };
      admin_settings: {
        Row: {
          admin_id: string;
          pix_city: string | null;
          pix_key: string | null;
          pix_key_type: string | null;
          pix_name: string | null;
          updated_at: string;
        };
        Insert: {
          admin_id: string;
          pix_city?: string | null;
          pix_key?: string | null;
          pix_key_type?: string | null;
          pix_name?: string | null;
          updated_at?: string;
        };
        Update: {
          admin_id?: string;
          pix_city?: string | null;
          pix_key?: string | null;
          pix_key_type?: string | null;
          pix_name?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      pix_key_audit: {
        Row: {
          admin_id: string;
          changed_at: string;
          id: number;
          new_key_masked: string | null;
          old_key_masked: string | null;
        };
        Insert: {
          admin_id: string;
          changed_at?: string;
          id?: number;
          new_key_masked?: string | null;
          old_key_masked?: string | null;
        };
        Update: {
          admin_id?: string;
          changed_at?: string;
          id?: number;
          new_key_masked?: string | null;
          old_key_masked?: string | null;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          hits: number;
          key: string;
          window_start: string;
        };
        Insert: {
          hits?: number;
          key: string;
          window_start?: string;
        };
        Update: {
          hits?: number;
          key?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          establishment_id: string;
          allow_quantity: boolean;
          description: string | null;
          is_active: boolean;
          max_select: number;
          min_select: number;
          created_at: string;
          id: string;
          name: string;
          position: number;
        };
        Insert: {
          establishment_id?: string;
          allow_quantity?: boolean;
          description?: string | null;
          is_active?: boolean;
          max_select?: number;
          min_select?: number;
          created_at?: string;
          id?: string;
          name: string;
          position?: number;
        };
        Update: {
          establishment_id?: string;
          allow_quantity?: boolean;
          description?: string | null;
          is_active?: boolean;
          max_select?: number;
          min_select?: number;
          created_at?: string;
          id?: string;
          name?: string;
          position?: number;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          note: string | null;
          order_id: string;
          product_id: string;
          quantity: number;
        };
        Insert: {
          note?: string | null;
          order_id: string;
          product_id: string;
          quantity: number;
        };
        Update: {
          note?: string | null;
          order_id?: string;
          product_id?: string;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          done_at: string | null;
          last_request_id: string | null;
          paid_at: string | null;
          paid_by: string | null;
          version: number;
          created_at: string;
          id: string;
          participant_id: string;
          round_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          done_at?: string | null;
          last_request_id?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          version?: number;
          created_at?: string;
          id?: string;
          participant_id: string;
          round_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          done_at?: string | null;
          last_request_id?: string | null;
          paid_at?: string | null;
          paid_by?: string | null;
          version?: number;
          created_at?: string;
          id?: string;
          participant_id?: string;
          round_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_participant_id_fkey";
            columns: ["participant_id"];
            isOneToOne: false;
            referencedRelation: "participants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_round_id_fkey";
            columns: ["round_id"];
            isOneToOne: false;
            referencedRelation: "rounds";
            referencedColumns: ["id"];
          },
        ];
      };
      participants: {
        Row: {
          locked_until: string | null;
          phone_e164: string | null;
          recovery_attempts: number;
          recovery_hash: string | null;
          created_at: string;
          display_name: string;
          id: string;
          token_hash: string;
        };
        Insert: {
          locked_until?: string | null;
          phone_e164?: string | null;
          recovery_attempts?: number;
          recovery_hash?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          token_hash: string;
        };
        Update: {
          locked_until?: string | null;
          phone_e164?: string | null;
          recovery_attempts?: number;
          recovery_hash?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          token_hash?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          is_active: boolean;
          price_cents: number | null;
          category_id: string | null;
          created_at: string;
          description: string | null;
          id: string;
          image_path: string | null;
          name: string;
          position: number;
          updated_at: string;
        };
        Insert: {
          is_active?: boolean;
          price_cents?: number | null;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          name: string;
          position?: number;
          updated_at?: string;
        };
        Update: {
          is_active?: boolean;
          price_cents?: number | null;
          category_id?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_path?: string | null;
          name?: string;
          position?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          created_at: string;
          endpoint: string;
          id: string;
          participant_id: string;
        };
        Insert: {
          created_at?: string;
          endpoint: string;
          id?: string;
          participant_id: string;
        };
        Update: {
          created_at?: string;
          endpoint?: string;
          id?: string;
          participant_id?: string;
        };
        Relationships: [];
      };
      rounds: {
        Row: {
          establishment_id: string;
          closes_at: string | null;
          created_by: string | null;
          last_printed_at: string | null;
          opens_at: string | null;
          closed_at: string | null;
          id: string;
          name: string;
          opened_at: string;
          status: string;
        };
        Insert: {
          establishment_id?: string;
          closes_at?: string | null;
          created_by?: string | null;
          last_printed_at?: string | null;
          opens_at?: string | null;
          closed_at?: string | null;
          id?: string;
          name: string;
          opened_at?: string;
          status?: string;
        };
        Update: {
          establishment_id?: string;
          closes_at?: string | null;
          created_by?: string | null;
          last_printed_at?: string | null;
          opens_at?: string | null;
          closed_at?: string | null;
          id?: string;
          name?: string;
          opened_at?: string;
          status?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      begin_recovery: {
        Args: { p_phone: string };
        Returns: { participant_id: string; recovery_hash: string }[];
      };
      finish_recovery: {
        Args: { p_participant: string; p_token_hash: string };
        Returns: undefined;
      };
      get_active_round: {
        Args: Record<PropertyKey, never>;
        Returns: {
          closed_at: string | null;
          closes_at: string | null;
          id: string;
          name: string;
          opened_at: string;
          opens_at: string | null;
          server_now: string;
          state: string;
          status: string;
        }[];
      };
      get_active_round_for: {
        Args: { p_establishment: string };
        Returns: {
          closed_at: string | null;
          closes_at: string | null;
          id: string;
          name: string;
          opened_at: string;
          opens_at: string | null;
          server_now: string;
          state: string;
          status: string;
        }[];
      };
      get_round_state: {
        Args: { p_round: string };
        Returns: string;
      };
      hit_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number };
        Returns: boolean;
      };
      submit_order: {
        Args: {
          p_expected_version: number;
          p_items: Json;
          p_participant: string;
          p_request_id: string;
          p_round: string;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
