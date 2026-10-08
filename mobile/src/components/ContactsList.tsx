import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Avatar from './Avatar';
import type { User } from '../types';
import { getEntityId } from '../utils/ids';

type ContactsListProps = {
  contacts: User[];
  onSelect: (user: User) => void;
};

export default function ContactsList({ contacts, onSelect }: ContactsListProps) {
  return (
    <FlashList
      data={contacts}
      keyExtractor={(item, index) => getEntityId(item) || `contact-${index}`}
      renderItem={({ item }) => (
        <Pressable className="h-[72px] flex-row items-center gap-3 bg-white px-4" onPress={() => onSelect(item)}>
          <Avatar user={item} size={48} sharedTag={`avatar-${getEntityId(item)}`} />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold text-slate-950" numberOfLines={1}>
              {item.name || item.email || 'Syncrova user'}
            </Text>
            <Text className="mt-1 text-[13px] text-slate-500" numberOfLines={1}>
              {item.email || 'Tap to start a chat'}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}
