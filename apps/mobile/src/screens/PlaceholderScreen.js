import React from "react";
import { View, Text, Button } from "react-native";
import { useSessionStore } from "../store/session";
import { colors } from "../theme/colors";

export default function PlaceholderScreen({ route }) {
  const { title } = route.params || { title: "Placeholder" };
  const { logOut } = useSessionStore();

  return (
    <View className="flex-1 justify-center items-center bg-surface">
      <Text className="text-2xl text-textDark mb-5">
        {title}
      </Text>
      <Button title="Log Out" color={colors.primary} onPress={logOut} />
    </View>
  );
}
