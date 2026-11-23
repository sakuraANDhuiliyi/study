import React, { useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import type { MobileClient } from './client';
import { a, AButton } from './assignment-ui';
import { State } from './staff-ui';
import { useResource } from './resource';
import { programmingRoot, programmingApi, type CreativeIdea, type CreativeList } from './programming-model';
import { ReadonlyProjectFiles, useProgrammingOperation } from './programming-ui';
import { shareProgrammingFile } from './programming-files';

export function Creative({ client, openProject }: { client: MobileClient; openProject(id: string): void }) {
  const [id, setId] = useState('');
  if (id)
    return (
      <CreativeDetail key={id} client={client} id={id} openProject={openProject} back={() => setId('')} />
    );
  return <CreativeGallery client={client} open={setId} />;
}
function CreativeGallery({ client, open }: { client: MobileClient; open(id: string): void }) {
  const [text, setText] = useState(''),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [saved, setSaved] = useState(false),
    [edition, setEdition] = useState('all'),
    [page, setPage] = useState(1);
  const q = useResource<CreativeList>(
    client,
    programmingRoot +
      '/creative?' +
      new URLSearchParams({
        q: query,
        category,
        collection: saved ? 'saved' : 'all',
        edition,
        page: String(page),
        pageSize: '12',
      }),
  );
  const operation = useProgrammingOperation(client);
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <Text style={a.title}>编程创意广场</Text>
      <Text style={a.muted}>阅读创作思路、来源许可与真实源码，再创建自己的可编辑项目。</Text>
      <View style={a.card}>
        <TextInput
          accessibilityLabel="搜索编程创意"
          style={a.input}
          value={text}
          onChangeText={setText}
          maxLength={100}
          placeholder="搜索主题、技术或创意"
        />
        <View style={a.row}>
          <AButton
            title="搜索创意"
            onPress={() => {
              setQuery(text.trim());
              setPage(1);
            }}
          />
          <AButton
            title={saved ? '显示全部作品' : '只看我的收藏'}
            secondary
            onPress={() => {
              setSaved(!saved);
              setPage(1);
            }}
          />
          <AButton title="刷新创意" secondary onPress={q.reload} />
        </View>
        <View style={a.row}>
          {[
            ['all', '全部版本'],
            ['new', '进阶创意'],
            ['foundation', '基础创意'],
          ].map(([value, label]) => (
            <AButton
              key={value}
              title={label}
              secondary={edition !== value}
              onPress={() => {
                setEdition(value);
                setPage(1);
              }}
            />
          ))}
        </View>
        <View style={a.row}>
          <AButton
            title="全部分类"
            secondary={!!category}
            onPress={() => {
              setCategory('');
              setPage(1);
            }}
          />
          {q.data?.categories.map((item) => (
            <AButton
              key={item.name}
              title={item.name + '（' + item.count + '）'}
              secondary={category !== item.name}
              onPress={() => {
                setCategory(item.name);
                setPage(1);
              }}
            />
          ))}
        </View>
      </View>
      <State resource={q} />
      {!!operation.notice && <Text style={a.notice}>{operation.notice}</Text>}
      {!q.error &&
        q.data?.items.map((item) => (
          <View key={item.id} style={a.card}>
            <Text style={a.subtitle}>{item.title}</Text>
            <Text style={a.notice}>
              {item.category} · {item.tags.join('、')}
            </Text>
            <Text style={a.body}>{item.description}</Text>
            <View style={a.row}>
              <AButton title={'查看创意：' + item.title} onPress={() => open(item.id)} />
              <AButton
                title={item.saved ? '取消收藏：' + item.title : '收藏：' + item.title}
                secondary
                disabled={operation.busy}
                onPress={() =>
                  void operation.run(() => programmingApi.favorite(client, item.id, !item.saved), q.reload)
                }
              />
            </View>
          </View>
        ))}
      {q.data && !q.error && (
        <>
          <Text style={a.muted}>
            匹配 {q.data.total} / {q.data.totalCatalog} 个创意 · 已收藏 {q.data.savedCount}
          </Text>
          {q.data.items.length === 0 && <Text style={a.muted}>当前筛选没有匹配作品。</Text>}
          <View style={a.row}>
            <AButton title="上一页创意" secondary disabled={page === 1} onPress={() => setPage(page - 1)} />
            <Text style={a.muted}>第 {page} 页</Text>
            <AButton
              title="下一页创意"
              secondary
              disabled={page * 12 >= q.data.total}
              onPress={() => setPage(page + 1)}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
function CreativeDetail({
  client,
  id,
  openProject,
  back,
}: {
  client: MobileClient;
  id: string;
  openProject(id: string): void;
  back(): void;
}) {
  const q = useResource<CreativeIdea>(client, programmingRoot + '/creative/' + encodeURIComponent(id));
  const [title, setTitle] = useState(''),
    operation = useProgrammingOperation(client);
  const idea = q.data;
  return (
    <ScrollView contentContainerStyle={a.page} keyboardShouldPersistTaps="handled">
      <AButton title="返回创意广场" secondary disabled={operation.busy} onPress={back} />
      <State resource={q} />
      {!!operation.notice && (
        <Text accessibilityRole="alert" style={a.notice}>
          {operation.notice}
        </Text>
      )}
      {idea && !q.error && (
        <>
          <Text style={a.title}>{idea.title}</Text>
          <Text style={a.notice}>
            {idea.category} · {idea.tags.join('、')}
          </Text>
          <Text style={a.body}>{idea.description}</Text>
          <View style={a.card}>
            <Text style={a.subtitle}>学习目标</Text>
            {idea.learningGoals.map((goal, i) => (
              <Text key={i} style={a.body}>
                {i + 1}. {goal}
              </Text>
            ))}
          </View>
          <View style={a.card}>
            <Text style={a.subtitle}>来源与许可</Text>
            <Text selectable style={a.body}>
              {idea.source.repository}
            </Text>
            <Text selectable style={a.muted}>
              固定版本：{idea.source.commit}
            </Text>
            <Text style={a.body}>许可：{idea.source.license}</Text>
            {idea.source.usageNotice && <Text style={a.notice}>{idea.source.usageNotice}</Text>}
            {idea.source.scope && <Text style={a.body}>{idea.source.scope}</Text>}
            {idea.source.changes && <Text style={a.body}>{idea.source.changes}</Text>}
            {idea.source.videos.map((video, i) => (
              <View key={i}>
                <Text style={a.body}>
                  {video.platform} · {video.title}
                </Text>
                <Text selectable style={a.muted}>
                  {video.url}
                </Text>
              </View>
            ))}
            {idea.source.licenseText && (
              <Text selectable style={a.muted}>
                {idea.source.licenseText}
              </Text>
            )}
          </View>
          {idea.files && <ReadonlyProjectFiles files={idea.files} label="创意源码" />}
          <View style={a.card}>
            <AButton
              title={idea.saved ? '取消收藏此创意' : '收藏此创意'}
              secondary
              disabled={operation.busy}
              onPress={() =>
                void operation.run(() => programmingApi.favorite(client, id, !idea.saved), q.reload)
              }
            />
            <TextInput
              accessibilityLabel="创意项目名称"
              value={title}
              onChangeText={setTitle}
              placeholder={idea.title + ' · 我的改编'}
              style={a.input}
              maxLength={160}
              editable={!operation.busy}
            />
            <AButton
              title="创建可编辑创意项目"
              disabled={operation.busy}
              onPress={() =>
                Alert.alert(
                  '创建我的创意项目？',
                  '会复制此版本的源码及来源许可到你的独立工作区。请保留 NOTICE.txt 中的归属与许可。',
                  [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '创建项目',
                      onPress: () =>
                        void operation.run(
                          () =>
                            programmingApi.fromIdea(
                              client,
                              idea,
                              title.trim() || (idea.title + ' · 我的改编').slice(0, 160),
                            ),
                          (project) => openProject(project.id),
                        ),
                    },
                  ],
                )
              }
            />
            <AButton
              title="导出创意源码ZIP"
              secondary
              disabled={operation.busy}
              onPress={() => void operation.run(() => shareProgrammingFile(client, id, 'creative'))}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}
