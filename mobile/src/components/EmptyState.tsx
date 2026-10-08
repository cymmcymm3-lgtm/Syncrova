import React from 'react';
import { Text, View } from 'react-native';
import { MessageCircle } from 'lucide-react-native';

export default function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <View className="h-16 w-16 items-center justify-center rounded-full bg-blue-50">
        <MessageCircle color="#0A7CFF" size={28} />
      </View>
      <Text className="mt-4 text-center text-lg font-semibold text-slate-950">{title}</Text>
      {body ? <Text className="mt-2 text-center text-sm leading-5 text-slate-500">{body}</Text> : null}
    </View>
  );
}
